(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const SHARED_POLL_MS = 30000;
  const OFFER_REFRESH_MS = 5 * 60 * 1000;
  const REMOTE_ITEM_FIELDS = 'id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at';
  const db = window.SlevaoSupabase.getClient();
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function pragueDate(value = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'
    }).format(value);
  }

  function addCalendarDays(dateKey, days) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return String(dateKey || '');
    return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
  }

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(location.search);
  const sharedToken = hashParams.get('share') || queryParams.get('share') || '';
  const sharedMode = Boolean(sharedToken);

  let rows = [];
  let session = null;
  let listId = null;
  let activeOffers = [];
  let customOfferMap = new Map();
  let sharedPermission = 'view';
  let sharedPollTimer = 0;
  let sharedBusy = false;
  let sharedRevision = '';
  let sharedLastRevisionCheck = 0;
  let offersLoading = null;
  let lastOffersLoadedAt = 0;
  let offerBusinessDay = '';
  const rowMutationQueues = new Map();
  const rowMutationVersions = new Map();
  const rowConfirmedStates = new Map();
  const deletingRows = new Set();

  function readLocal() {
    try {
      const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveLocal() {
    if (sharedMode) return;
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
    window.SlevaoPublic?.updateNavCount?.();
  }

  function rowKey(row) {
    return row.product_id ? `p:${row.product_id}` : `c:${norm(row.custom_name || row.name)}`;
  }

  function mutationKey(row) {
    return String(row?.local_id || row?.server_id || rowKey(row));
  }

  function nextMutationVersion(row) {
    const key = mutationKey(row);
    const version = Number(rowMutationVersions.get(key) || 0) + 1;
    rowMutationVersions.set(key, version);
    return { key, version };
  }

  function isLatestMutation(key, version) {
    return Number(rowMutationVersions.get(key) || 0) === Number(version || 0);
  }

  function rememberConfirmedState(row, state) {
    const key = mutationKey(row);
    rowConfirmedStates.set(key, { ...state, server_id: row?.server_id || state?.server_id || null });
  }

  function ensureConfirmedState(row, fallback) {
    if (!row?.server_id) return;
    const key = mutationKey(row);
    if (!rowConfirmedStates.has(key)) rememberConfirmedState(row, fallback);
  }

  function rollbackToConfirmed(row, key, version, fallback) {
    if (!isLatestMutation(key, version)) return;
    Object.assign(row, rowConfirmedStates.get(key) || fallback);
    render();
  }

  function enqueueRowMutation(row, task) {
    const key = mutationKey(row);
    const previous = rowMutationQueues.get(key) || Promise.resolve();
    const queued = previous.catch(() => {}).then(task);
    rowMutationQueues.set(key, queued);
    queued.then(
      () => { if (rowMutationQueues.get(key) === queued) rowMutationQueues.delete(key); },
      () => { if (rowMutationQueues.get(key) === queued) rowMutationQueues.delete(key); }
    );
    return queued;
  }

  async function waitForRowMutations(targetRows) {
    const pending = [...new Set((targetRows || []).map((row) => rowMutationQueues.get(mutationKey(row))).filter(Boolean))];
    if (pending.length) await Promise.allSettled(pending);
  }

  function clearMutationState(row) {
    const key = mutationKey(row);
    rowMutationQueues.delete(key);
    rowMutationVersions.delete(key);
    rowConfirmedStates.delete(key);
    deletingRows.delete(key);
  }

  function productSignature(sourceRows = rows) {
    return [...new Set(sourceRows
      .filter((row) => !row.completed)
      .map((row) => row.product_id
        ? `p:${String(row.product_id)}`
        : `c:${norm(row.custom_name || row.name)}`)
      .filter((value) => !value.endsWith(':')))]
      .sort()
      .join('|');
  }

  function sharedRows(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((item) => ({
      local_id: item.id || uid(),
      server_id: item.id || null,
      key: rowKey(item),
      product_id: item.product_id || null,
      selected_offer_id: item.selected_offer_id || null,
      custom_name: item.custom_name || null,
      name: item.name || item.custom_name || 'Položka',
      brand: item.brand || null,
      quantity_text: item.quantity_text || null,
      image_url: item.image_url || null,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'ks',
      completed: Boolean(item.is_completed),
      added_at: item.created_at,
      updated_at: item.updated_at
    }));
  }

  function applySharedData(data, { renderNow = true } = {}) {
    listId = data?.list_id || listId;
    sharedPermission = data?.permission === 'edit' ? 'edit' : 'view';
    sharedRevision = String(data?.revision || sharedRevision || '');
    rows = sharedRows(data);
    const listName = data?.name || 'Sdílený nákupní seznam';
    document.title = `${listName} | Slevao.cz`;
    $('accountStatus').innerHTML = sharedPermission === 'edit'
      ? '<strong>Sdílený seznam:</strong> změny se ukládají všem, kdo mají odkaz.'
      : '<strong>Sdílený seznam pouze ke čtení.</strong>';
    $('shareList').textContent = 'Sdílet tento odkaz';
    $('customName').disabled = sharedPermission !== 'edit';
    $('customQuantity').disabled = sharedPermission !== 'edit';
    $('addCustom').disabled = sharedPermission !== 'edit';
    $('clearCompleted').disabled = sharedPermission !== 'edit';
    if (renderNow) render();
  }

  async function loadSharedList({ silent = false } = {}) {
    if (!sharedMode || sharedBusy) return;
    const beforeProducts = productSignature();
    sharedBusy = true;
    try {
      const { data, error } = await db.rpc('get_shared_shopping_list', { p_token: sharedToken });
      if (error) throw error;
      applySharedData(data || {});
      const productsChanged = beforeProducts !== productSignature();
      if (productsChanged || (!activeOffers.length && !customOfferMap.size)) await fetchOffers();
      if (!silent) showMessage('Sdílený seznam je aktuální.');
    } catch (error) {
      if (!silent) showMessage(error.message || 'Sdílený seznam se nepodařilo otevřít.', true);
      if (!$('listItems').children.length || $('listItems').querySelector('.sfLoading')) {
        $('listItems').innerHTML = '<div class="sfEmpty">Tento sdílený odkaz neexistuje, vypršel nebo byl zrušen.</div>';
      }
    } finally {
      sharedBusy = false;
    }
  }

  async function checkSharedRevision({ force = false } = {}) {
    if (!sharedMode || sharedBusy || (document.hidden && !force)) return;
    const now = Date.now();
    if (!force && now - sharedLastRevisionCheck < 2500) return;
    sharedLastRevisionCheck = now;
    try {
      const { data, error } = await db.rpc('get_shared_shopping_list_revision', { p_token: sharedToken });
      if (error) throw error;
      const revision = String(data?.revision || '');
      if (!revision) return;
      if (!sharedRevision) {
        sharedRevision = revision;
        return;
      }
      if (revision !== sharedRevision) await loadSharedList({ silent: true });
    } catch (error) {
      console.debug('Kontrola revize sdíleného seznamu selhala:', error);
    }
  }

  async function mutateShared(action, row = null, overrides = {}) {
    if (!sharedMode || sharedPermission !== 'edit') {
      throw new Error('Tento sdílený odkaz dovoluje pouze prohlížení.');
    }
    const beforeProducts = productSignature();
    const payload = {
      p_token: sharedToken,
      p_action: action,
      p_item_id: row?.server_id || null,
      p_product_id: overrides.product_id ?? row?.product_id ?? null,
      p_selected_offer_id: overrides.selected_offer_id ?? row?.selected_offer_id ?? null,
      p_custom_name: overrides.custom_name ?? row?.custom_name ?? row?.name ?? null,
      p_quantity: Number(overrides.quantity ?? row?.quantity ?? 1),
      p_unit: overrides.unit ?? row?.unit ?? 'ks',
      p_is_completed: Boolean(overrides.completed ?? row?.completed ?? false)
    };
    sharedBusy = true;
    try {
      const { data, error } = await db.rpc('mutate_shared_shopping_list', payload);
      if (error) throw error;
      applySharedData(data || {});
      if (beforeProducts !== productSignature() || (!activeOffers.length && !customOfferMap.size)) await fetchOffers();
      return data;
    } finally {
      sharedBusy = false;
    }
  }

  async function findRemoteList() {
    if (!session) return null;
    const { data, error } = await db.from('shopping_lists')
      .select('id,name')
      .eq('user_id', session.user.id)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function ensureRemoteList() {
    if (!session) return null;
    const existing = await findRemoteList();
    if (existing?.id) return existing.id;

    const { data, error: createError } = await db.from('shopping_lists')
      .insert({ user_id: session.user.id, name: 'Můj nákup' })
      .select('id')
      .single();
    if (!createError && data?.id) return data.id;
    if (createError?.code !== '23505') throw createError;

    const concurrent = await findRemoteList();
    if (concurrent?.id) return concurrent.id;
    throw createError;
  }

  async function findConcurrentRemoteItem(row) {
    let query = db.from('shopping_list_items')
      .select(REMOTE_ITEM_FIELDS)
      .eq('shopping_list_id', listId);

    if (row.product_id) {
      const { data, error } = await query
        .eq('product_id', row.product_id)
        .order('created_at', { ascending:true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    }

    const customName = String(row.custom_name || row.name || '').trim();
    if (!customName) return null;
    const normalizedCustomName = customName.toLocaleLowerCase('cs-CZ');
    const { data, error } = await query
      .is('product_id', null)
      .order('created_at', { ascending:true });
    if (error) throw error;
    return (data || []).find((item) => (
      String(item.custom_name || '').trim().toLocaleLowerCase('cs-CZ') === normalizedCustomName
    )) || null;
  }

  function adoptRemoteState(row, remote) {
    if (!row || !remote?.id) return;
    row.server_id = remote.id;
    row.selected_offer_id = remote.selected_offer_id || null;
    row.quantity = Number(remote.quantity || row.quantity || 1);
    row.unit = remote.unit || row.unit || 'ks';
    row.completed = Boolean(remote.is_completed);
    row.updated_at = remote.updated_at || row.updated_at || null;
    if (!row.product_id && remote.custom_name) {
      row.custom_name = remote.custom_name;
      row.name = remote.custom_name;
    }
  }

  async function mergeRemote() {
    if (!session || sharedMode) return;
    listId = await ensureRemoteList();
    const { data: remote, error } = await db.from('shopping_list_items')
      .select(REMOTE_ITEM_FIELDS)
      .eq('shopping_list_id', listId)
      .order('created_at');
    if (error) throw error;

    const localMap = new Map(rows.map((row) => [rowKey(row), row]));
    const remoteMap = new Map((remote || []).map((row) => [rowKey(row), row]));
    const missingRemote = rows.filter((row) => !remoteMap.has(rowKey(row)));

    for (const row of missingRemote) {
      const payload = {
        shopping_list_id: listId,
        product_id: row.product_id || null,
        selected_offer_id: row.selected_offer_id || null,
        custom_name: row.product_id ? null : (row.custom_name || row.name),
        quantity: Number(row.quantity || 1),
        unit: row.unit || 'ks',
        is_completed: Boolean(row.completed)
      };
      const { data: inserted, error: insertError } = await db.from('shopping_list_items')
        .insert(payload)
        .select(REMOTE_ITEM_FIELDS)
        .single();

      if (!insertError && inserted) {
        remoteMap.set(rowKey(inserted), inserted);
        continue;
      }
      if (insertError?.code !== '23505') throw insertError;

      const concurrent = await findConcurrentRemoteItem(row);
      if (!concurrent) throw insertError;
      remoteMap.set(rowKey(concurrent), concurrent);
    }

    const productIds = [...new Set([...remoteMap.values()].map((row) => row.product_id).filter(Boolean))];
    let products = [];
    if (productIds.length) {
      const result = await db.from('products').select('id,name,brand,quantity_text,image_url').in('id', productIds);
      if (result.error) throw result.error;
      products = result.data || [];
    }
    const productMap = new Map(products.map((product) => [product.id, product]));

    for (const [key, item] of remoteMap) {
      const product = productMap.get(item.product_id);
      const local = localMap.get(key);
      if (local) {
        adoptRemoteState(local, item);
      } else {
        rows.push({
          local_id: uid(),
          server_id: item.id,
          key,
          product_id: item.product_id || null,
          selected_offer_id: item.selected_offer_id || null,
          custom_name: item.custom_name || null,
          name: product?.name || item.custom_name || 'Položka',
          brand: product?.brand || null,
          quantity_text: product?.quantity_text || null,
          image_url: product?.image_url || null,
          quantity: Number(item.quantity || 1),
          unit: item.unit || 'ks',
          completed: Boolean(item.is_completed),
          added_at: item.created_at,
          updated_at: item.updated_at
        });
      }
    }
    saveLocal();
  }

  async function persistRow(row, state = row) {
    if (sharedMode) {
      await mutateShared('update', state);
      return;
    }
    saveLocal();
    if (!session || !listId) return;
    const payload = {
      shopping_list_id: listId,
      product_id: state.product_id || null,
      selected_offer_id: state.selected_offer_id || null,
      custom_name: state.product_id ? null : (state.custom_name || state.name),
      quantity: Number(state.quantity || 1),
      unit: state.unit || 'ks',
      is_completed: Boolean(state.completed)
    };
    if (row.server_id) {
      const { error } = await db.from('shopping_list_items')
        .update(payload)
        .eq('id', row.server_id)
        .eq('shopping_list_id', listId);
      if (error) throw error;
      return;
    }

    const { data, error } = await db.from('shopping_list_items')
      .insert(payload)
      .select(REMOTE_ITEM_FIELDS)
      .single();
    if (!error && data?.id) {
      adoptRemoteState(row, data);
      saveLocal();
      return;
    }
    if (error?.code !== '23505') throw error;

    const concurrent = await findConcurrentRemoteItem(state);
    if (!concurrent) throw error;
    adoptRemoteState(row, concurrent);
    saveLocal();
  }

  async function deleteRow(row) {
    if (sharedMode) {
      await mutateShared('delete', row);
      return;
    }
    if (session && row.server_id) {
      const scopedListId = listId || await ensureRemoteList();
      const { error } = await db.from('shopping_list_items')
        .delete()
        .eq('id', row.server_id)
        .eq('shopping_list_id', scopedListId);
      if (error) throw error;
    }
    rows = rows.filter((item) => item.local_id !== row.local_id);
    saveLocal();
  }

  async function fetchOffers() {
    if (offersLoading) return offersLoading;
    offersLoading = (async () => {
      const today = pragueDate();
      const upcomingTo = addCalendarDays(today, 7);
      const activeRows = rows.filter((row) => !row.completed);
      const productIds = [...new Set(activeRows.map((row) => row.product_id).filter(Boolean))];
      const customQueries = [...new Set(activeRows
        .filter((row) => !row.product_id)
        .map((row) => String(row.custom_name || row.name || '').trim())
        .filter(Boolean))];

      const productPromise = productIds.length
        ? db.from('offers')
          .select('id,product_id,store_id,title,price,old_price,image_url,unit_price,unit_price_unit,valid_from,valid_to,stores(id,name,slug),products(id,name,brand,quantity_text,image_url)')
          .in('product_id', productIds)
          .eq('status', 'published')
          .lte('valid_from', upcomingTo)
          .gte('valid_to', today)
          .limit(5000)
        : Promise.resolve({ data: [], error: null });

      const customPromise = customQueries.length
        ? db.rpc('get_public_shopping_list_candidates', {
          p_queries: customQueries,
          p_limit_per_query: 30
        })
        : Promise.resolve({ data: [], error: null });

      const [productResult, customResult] = await Promise.all([productPromise, customPromise]);
      if (productResult.error) throw productResult.error;
      if (customResult.error) throw customResult.error;

      activeOffers = productResult.data || [];
      customOfferMap = new Map();
      for (const candidate of customResult.data || []) {
        const key = String(candidate.query_key || norm(candidate.query_text));
        if (!key || !candidate.offer) continue;
        const offers = customOfferMap.get(key) || [];
        offers.push(candidate.offer);
        customOfferMap.set(key, offers);
      }

      rows.forEach((row) => {
        if (!row.image_url) row.image_url = itemImage(row) || null;
      });
      lastOffersLoadedAt = Date.now();
      offerBusinessDay = today;
      render();
    })();
    try {
      return await offersLoading;
    } finally {
      offersLoading = null;
    }
  }

  function offersAreStale() {
    return pragueDate() !== offerBusinessDay || Date.now() - lastOffersLoadedAt >= OFFER_REFRESH_MS;
  }

  async function refreshOffersIfStale() {
    if (document.hidden || !offersAreStale()) return;
    try {
      await fetchOffers();
    } catch (error) {
      showMessage(`Ceny se nepodařilo obnovit: ${error.message}`, true);
    }
  }

  function offersForItem(item, allowedStores = null, today = pragueDate()) {
    const source = item.product_id
      ? activeOffers.filter((offer) => offer.product_id === item.product_id)
      : (customOfferMap.get(norm(item.custom_name || item.name)) || []);
    const eligible = source.filter((offer) => !offer.valid_to || String(offer.valid_to) >= today);
    return allowedStores ? eligible.filter((offer) => allowedStores.has(offer.store_id)) : eligible;
  }

  function cheapestForItem(item, allowedStores = null, today = pragueDate()) {
    const candidates = offersForItem(item, allowedStores, today);
    const current = candidates.filter((offer) => !offer.valid_from || String(offer.valid_from) <= today);
    return (current.length ? current : candidates).slice().sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
  }

  function planFromOffers(items, allowedStores = null, today = pragueDate()) {
    const chosen = [];
    let total = 0;
    for (const item of items) {
      const offer = cheapestForItem(item, allowedStores, today);
      if (!offer) return null;
      const quantity = Math.max(0.01, Number(item.quantity || 1));
      total += Number(offer.price || 0) * quantity;
      chosen.push({ item, offer, subtotal: Number(offer.price || 0) * quantity });
    }
    const stores = [...new Map(chosen.map((row) => [row.offer.store_id, row.offer.stores])).values()];
    return {
      total,
      chosen,
      stores,
      upcomingCount: chosen.filter((row) => String(row.offer.valid_from || '') > today).length
    };
  }

  function calculatePlans() {
    const today = pragueDate();
    const allItems = rows.filter((row) => !row.completed);
    const items = allItems.filter((item) => offersForItem(item, null, today).length > 0);
    const unresolved = allItems.filter((item) => !offersForItem(item, null, today).length);
    if (!items.length) return { items, unresolved, absolute: null, oneStore: null, balanced: null };

    const absolute = planFromOffers(items, null, today);
    const storeIds = [...new Set(items.flatMap((item) => offersForItem(item, null, today).map((offer) => offer.store_id)).filter(Boolean))];

    let oneStore = null;
    for (const storeId of storeIds) {
      const plan = planFromOffers(items, new Set([storeId]), today);
      if (plan && (!oneStore || plan.total < oneStore.total)) oneStore = plan;
    }

    let balanced = oneStore;
    let balancedScore = oneStore ? oneStore.total : Infinity;
    for (let i = 0; i < storeIds.length; i++) {
      for (let j = i; j < storeIds.length; j++) {
        const plan = planFromOffers(items, new Set([storeIds[i], storeIds[j]]), today);
        if (!plan) continue;
        const score = plan.total + Math.max(0, plan.stores.length - 1) * 35;
        if (score < balancedScore) {
          balanced = plan;
          balancedScore = score;
        }
      }
    }
    return { items, unresolved, absolute, oneStore, balanced };
  }

  function planHtml(title, plan, description, best = false) {
    if (!plan) {
      return `<div class="sfResultBox"><h3>${esc(title)}</h3><p class="sfMuted">Pro tuto variantu zatím chybí dostatek cen.</p></div>`;
    }
    const groups = new Map();
    plan.chosen.forEach(({ item, offer, subtotal }) => {
      const name = offer.stores?.name || 'Obchod';
      const group = groups.get(name) || [];
      group.push(`${item.name} – ${money(subtotal)} Kč`);
      groups.set(name, group);
    });
    const upcoming = plan.upcomingCount
      ? ` ${plan.upcomingCount} položek používá akci začínající během příštích 7 dnů.`
      : '';
    return `<div class="sfResultBox ${best ? 'best' : ''}"><h3>${esc(title)}</h3><div class="sfResultPrice">${money(plan.total)} Kč</div><p class="sfMuted">${esc(description + upcoming)}</p><div class="sfStoreTags">${[...groups].map(([store, lines]) => `<span class="sfStoreTag" title="${esc(lines.join('\n'))}">${esc(store)} · ${lines.length} položek</span>`).join('')}</div></div>`;
  }

  function renderResults() {
    const plans = calculatePlans();
    const unresolvedText = plans.unresolved?.length
      ? `<p class="sfMuted">${plans.unresolved.length} ${plans.unresolved.length === 1 ? 'položku se nepodařilo spolehlivě najít v aktuálních nabídkách.' : 'položek se nepodařilo spolehlivě najít v aktuálních nabídkách.'}</p>`
      : '';
    $('optimizer').innerHTML = plans.items.length
      ? `${planHtml('Vše v jednom obchodě', plans.oneStore, 'Nejméně cestování. Všechny nalezené položky koupíš na jednom místě.')}${planHtml('Absolutně nejnižší cena', plans.absolute, `Nejnižší cena každé nalezené položky. ${plans.absolute?.stores.length || 0} zastávek.`)}${planHtml('Nejlepší poměr cena a cesta', plans.balanced, 'Do výpočtu se započítává penalizace 35 Kč za každou další zastávku.', true)}${unresolvedText}`
      : rows.some((row) => !row.completed)
        ? `<div class="sfEmpty">Pro položky v seznamu zatím nebyly nalezeny použitelné aktuální ceny.</div>${unresolvedText}`
        : '<div class="sfEmpty">Přidej akční produkty z domovské stránky nebo vlastní položky.</div>';
  }

  function itemImage(row) {
    if (row.image_url) return row.image_url;
    const source = row.product_id
      ? activeOffers
      : (customOfferMap.get(norm(row.custom_name || row.name)) || []);
    const offer = source.find((item) => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return (!row.product_id || item.product_id === row.product_id) && (item.image_url || product?.image_url);
    });
    const product = Array.isArray(offer?.products) ? offer.products[0] : offer?.products;
    return offer?.image_url || product?.image_url || '';
  }

  function render() {
    const active = rows.filter((row) => !row.completed);
    const readOnly = sharedMode && sharedPermission !== 'edit';
    $('listCount').textContent = `${active.length} položek`;
    $('listItems').innerHTML = rows.length
      ? rows.map((row) => {
        const disabled = readOnly || deletingRows.has(mutationKey(row));
        return `
        <article class="sfListItem ${row.completed ? 'done' : ''}" data-id="${esc(row.local_id)}">
          <input class="sfCheck" type="checkbox" data-complete ${row.completed ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Označit jako koupené">
          <span class="sfItemThumb ${itemImage(row) ? 'has-image' : ''}" aria-hidden="true">${itemImage(row) ? `<img src="${esc(itemImage(row))}" alt="" loading="lazy">` : '<span>▤</span>'}</span>
          <div class="sfItemCopy"><div class="sfItemName">${esc(row.name || row.custom_name || 'Položka')}</div><div class="sfItemMeta">${esc([row.brand, row.quantity_text, row.store_name].filter(Boolean).join(' · ') || (row.product_id ? 'Produkt Slevao.cz' : (offersForItem(row).length ? 'Vlastní položka · nalezené ceny' : 'Vlastní položka · zatím nenalezeno')))}</div></div>
          <input class="sfInput" type="number" min="0.01" step="0.01" value="${esc(row.quantity || 1)}" data-quantity ${disabled ? 'disabled' : ''} aria-label="Množství">
          <button class="sfIconButton" type="button" data-delete ${disabled ? 'disabled' : ''} aria-label="Odstranit">×</button>
        </article>`;
      }).join('')
      : '<div class="sfEmpty">Seznam je prázdný.</div>';
    renderResults();
    saveLocal();
  }

  async function addCustom() {
    const name = $('customName').value.trim();
    const quantity = Math.max(0.01, Number($('customQuantity').value || 1));
    if (!name) {
      $('customName').focus();
      return;
    }

    if (sharedMode) {
      await mutateShared('add', null, { custom_name: name, quantity, unit: 'ks', completed: false });
      $('customName').value = '';
      $('customQuantity').value = '1';
      showMessage('Položka byla přidána do sdíleného seznamu.');
      return;
    }

    const existing = rows.find((row) => !row.product_id && norm(row.custom_name || row.name) === norm(name) && !row.completed);
    const previous = existing ? { ...existing } : null;
    if (existing) {
      ensureConfirmedState(existing, previous);
      existing.quantity = Number(existing.quantity || 1) + quantity;
    } else {
      rows.push({
        local_id: uid(),
        key: `c:${norm(name)}`,
        product_id: null,
        selected_offer_id: null,
        custom_name: name,
        name,
        quantity,
        unit: 'ks',
        completed: false,
        added_at: new Date().toISOString()
      });
    }
    $('customName').value = '';
    $('customQuantity').value = '1';
    const row = existing || rows.at(-1);
    const desired = { ...row };
    const { key, version } = nextMutationVersion(row);
    render();
    try {
      await enqueueRowMutation(row, async () => {
        try {
          await persistRow(row, desired);
          if (session) rememberConfirmedState(row, { ...row });
        } catch (error) {
          if (isLatestMutation(key, version)) rollbackToConfirmed(row, key, version, previous || desired);
          throw error;
        }
      });
      if (isLatestMutation(key, version)) await fetchOffers();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function showMessage(text, bad = false) {
    $('listMessage').textContent = text;
    $('listMessage').style.color = bad ? '#b32631' : '#0b7a58';
  }

  async function copyOrShare(url, text) {
    if (navigator.share) {
      await navigator.share({ title: 'Nákupní seznam Slevao.cz', text, url });
      return;
    }
    await navigator.clipboard.writeText(url || text);
    showMessage(url ? 'Odkaz na seznam byl zkopírován.' : 'Seznam byl zkopírován do schránky.');
  }

  async function shareList() {
    const lines = rows.filter((row) => !row.completed).map((row) => `${row.quantity || 1}× ${row.name || row.custom_name}`);
    if (!lines.length) {
      showMessage('Seznam je prázdný.', true);
      return;
    }

    try {
      if (sharedMode) {
        const url = `${location.origin}${location.pathname}#share=${encodeURIComponent(sharedToken)}`;
        await copyOrShare(url, 'Společný nákupní seznam, který lze průběžně upravovat.');
        return;
      }

      if (!session) {
        const text = `Nákupní seznam Slevao.cz\n\n${lines.join('\n')}`;
        await copyOrShare('', text);
        showMessage('Text seznamu byl sdílen. Pro živý společný seznam se přihlas.');
        return;
      }

      listId = listId || await ensureRemoteList();
      const { data: token, error } = await db.rpc('create_shopping_list_share', {
        p_list_id: listId,
        p_permission: 'edit',
        p_expires_days: 30
      });
      if (error) throw error;
      const url = `${location.origin}${location.pathname}#share=${encodeURIComponent(token)}`;
      await copyOrShare(url, 'Společný nákupní seznam Slevao.cz. Odkaz dovoluje upravovat a odškrtávat položky po dobu 30 dnů.');
      showMessage('Živý sdílený odkaz je platný 30 dnů. Nové sdílení zrušilo předchozí odkaz.');
    } catch (error) {
      if (error.name !== 'AbortError') showMessage(error.message || 'Sdílení se nepodařilo.', true);
    }
  }

  async function clearCompleted() {
    let completed = rows.filter((row) => row.completed);
    if (!completed.length) return;
    const targetKeys = new Set(completed.map(mutationKey));
    targetKeys.forEach((key) => deletingRows.add(key));
    render();

    try {
      await waitForRowMutations(completed);
      completed = rows.filter((row) => targetKeys.has(mutationKey(row)) && row.completed);
      if (!completed.length) return;

      if (sharedMode) {
        for (const row of completed) await enqueueRowMutation(row, () => deleteRow(row));
        completed.forEach(clearMutationState);
        showMessage('Koupené položky byly odstraněny ze sdíleného seznamu.');
        return;
      }

      if (session) {
        const ids = completed.map((row) => row.server_id).filter(Boolean);
        if (ids.length) {
          const scopedListId = listId || await ensureRemoteList();
          const { error } = await db.from('shopping_list_items')
            .delete()
            .eq('shopping_list_id', scopedListId)
            .in('id', ids);
          if (error) throw error;
        }
      }
      const completedIds = new Set(completed.map((row) => row.local_id));
      rows = rows.filter((row) => !completedIds.has(row.local_id));
      completed.forEach(clearMutationState);
      saveLocal();
      render();
    } catch (error) {
      showMessage(error.message || 'Položky se nepodařilo odstranit.', true);
    } finally {
      targetKeys.forEach((key) => deletingRows.delete(key));
      render();
    }
  }

  async function init() {
    if (sharedMode) {
      rows = [];
      $('accountStatus').textContent = 'Načítám sdílený seznam…';
      render();
      await loadSharedList();
      sharedPollTimer = window.setInterval(() => checkSharedRevision(), SHARED_POLL_MS);
      window.addEventListener('beforeunload', () => clearInterval(sharedPollTimer), { once: true });
      return;
    }

    // Lokální seznam musí být dostupný okamžitě i při výpadku Supabase.
    rows = readLocal();
    $('accountStatus').textContent = 'Seznam je připravený. Ověřuji synchronizaci účtu…';
    render();

    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      session = data?.session || null;
    } catch (error) {
      session = null;
      $('accountStatus').innerHTML = 'Seznam je uložen v tomto zařízení. <a href="ucet.html?redirect=seznam.html">Přihlásit a synchronizovat</a>.';
      showMessage('Cloud je dočasně nedostupný. Lokální seznam zůstává plně použitelný.', true);
    }

    $('accountStatus').innerHTML = session
      ? `Přihlášen jako <strong>${esc(session.user.email)}</strong> · seznam se synchronizuje.`
      : 'Seznam je uložen v tomto zařízení. <a href="ucet.html?redirect=seznam.html">Přihlásit a synchronizovat</a>.';

    if (session) {
      try {
        const ownerPreflight = window.SlevaoShoppingOwnerPreflight;
        if (ownerPreflight && typeof ownerPreflight.then === 'function') await ownerPreflight;
        // Cold-sync mohl odstranit lokální kopie položek smazaných v cloudu.
        // Před obousměrným merge proto vždy načti čerstvý lokální stav.
        rows = readLocal();
        render();
        await mergeRemote();
        render();
        showMessage('Seznam je synchronizovaný s účtem.');
      } catch (error) {
        showMessage(`Synchronizace se nepodařila: ${error.message}. Lokální seznam zůstává dostupný.`, true);
      }
    }

    render();
    try {
      await fetchOffers();
    } catch (error) {
      showMessage(`Ceny se nepodařilo načíst: ${error.message}. Položky seznamu ale zůstávají dostupné.`, true);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (sharedMode) checkSharedRevision({ force: true });
    refreshOffersIfStale();
  });
  window.addEventListener('focus', () => {
    if (sharedMode) checkSharedRevision({ force: true });
    refreshOffersIfStale();
  });

  $('addCustom').addEventListener('click', () => addCustom().catch((error) => showMessage(error.message, true)));
  $('customName').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addCustom().catch((error) => showMessage(error.message, true));
  });
  $('shareList').addEventListener('click', shareList);
  $('clearCompleted').addEventListener('click', clearCompleted);

  $('listItems').addEventListener('change', async (event) => {
    const article = event.target.closest('[data-id]');
    const row = rows.find((item) => item.local_id === article?.dataset.id);
    if (!row) return;
    const keyBeforeChange = mutationKey(row);
    if (deletingRows.has(keyBeforeChange)) {
      render();
      return;
    }
    const previous = { ...row };
    ensureConfirmedState(row, previous);
    if (event.target.matches('[data-complete]')) row.completed = event.target.checked;
    if (event.target.matches('[data-quantity]')) row.quantity = Math.max(0.01, Number(event.target.value || 1));
    row.updated_at = new Date().toISOString();
    const desired = { ...row };
    const { key, version } = nextMutationVersion(row);
    render();
    try {
      await enqueueRowMutation(row, async () => {
        try {
          await persistRow(row, desired);
          if (!sharedMode && session) rememberConfirmedState(row, { ...row });
        } catch (error) {
          if (isLatestMutation(key, version)) {
            if (sharedMode) await loadSharedList({ silent: true });
            else rollbackToConfirmed(row, key, version, previous);
          }
          throw error;
        }
      });
      if (!sharedMode && isLatestMutation(key, version) && rows.some((item) => item.local_id === row.local_id)) {
        await fetchOffers();
      }
    } catch (error) {
      showMessage(error.message || 'Změnu se nepodařilo uložit.', true);
    }
  });

  $('listItems').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (!button || button.disabled) return;
    const article = event.target.closest('[data-id]');
    const row = rows.find((item) => item.local_id === article?.dataset.id);
    if (!row) return;
    const key = mutationKey(row);
    if (deletingRows.has(key)) return;
    deletingRows.add(key);
    render();
    try {
      await enqueueRowMutation(row, () => deleteRow(row));
      if (!sharedMode) await fetchOffers();
      if (!rows.some((item) => item.local_id === row.local_id)) clearMutationState(row);
    } catch (error) {
      showMessage(error.message || 'Položku se nepodařilo odstranit.', true);
    } finally {
      deletingRows.delete(key);
      render();
    }
  });

  init().catch((error) => showMessage(error.message || 'Seznam se nepodařilo načíst.', true));
})();