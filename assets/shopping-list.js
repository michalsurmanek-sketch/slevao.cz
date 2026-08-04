(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (v) => Number(v || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  let rows = [];
  let session = null;
  let listId = null;
  let activeOffers = [];

  function readLocal() {
    try { const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }

  function saveLocal() {
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
    window.SlevaoPublic?.updateNavCount?.();
  }

  function rowKey(row) {
    return row.product_id ? `p:${row.product_id}` : `c:${norm(row.custom_name || row.name)}`;
  }

  async function ensureRemoteList() {
    if (!session) return null;
    const { data: existing, error } = await db.from('shopping_lists').select('id,name').eq('user_id', session.user.id).eq('is_archived', false).order('created_at').limit(1).maybeSingle();
    if (error) throw error;
    if (existing) return existing.id;
    const { data, error: createError } = await db.from('shopping_lists').insert({ user_id: session.user.id, name: 'Můj nákup' }).select('id').single();
    if (createError) throw createError;
    return data.id;
  }

  async function mergeRemote() {
    if (!session) return;
    listId = await ensureRemoteList();
    const { data: remote, error } = await db.from('shopping_list_items')
      .select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at')
      .eq('shopping_list_id', listId).order('created_at');
    if (error) throw error;

    const localMap = new Map(rows.map((row) => [rowKey(row), row]));
    const remoteMap = new Map((remote || []).map((row) => [rowKey(row), row]));
    const missingRemote = rows.filter((row) => !remoteMap.has(rowKey(row)));

    if (missingRemote.length) {
      const payload = missingRemote.map((row) => ({
        shopping_list_id: listId, product_id: row.product_id || null,
        selected_offer_id: row.selected_offer_id || null,
        custom_name: row.product_id ? null : (row.custom_name || row.name),
        quantity: Number(row.quantity || 1), unit: row.unit || 'ks', is_completed: Boolean(row.completed)
      }));
      const { data: inserted, error: insertError } = await db.from('shopping_list_items').insert(payload)
        .select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at');
      if (insertError) throw insertError;
      (inserted || []).forEach((item) => remoteMap.set(rowKey(item), item));
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
        local.server_id = item.id;
        local.quantity = Number(item.quantity || local.quantity || 1);
        local.completed = Boolean(item.is_completed);
      } else {
        rows.push({
          local_id: uid(), server_id: item.id, key,
          product_id: item.product_id || null, selected_offer_id: item.selected_offer_id || null,
          custom_name: item.custom_name || null, name: product?.name || item.custom_name || 'Položka',
          brand: product?.brand || null, quantity_text: product?.quantity_text || null,
          image_url: product?.image_url || null, quantity: Number(item.quantity || 1), unit: item.unit || 'ks',
          completed: Boolean(item.is_completed), added_at: item.created_at, updated_at: item.updated_at
        });
      }
    }
    saveLocal();
  }

  async function persistRow(row) {
    saveLocal();
    if (!session || !listId) return;
    const payload = {
      shopping_list_id: listId, product_id: row.product_id || null,
      selected_offer_id: row.selected_offer_id || null,
      custom_name: row.product_id ? null : (row.custom_name || row.name),
      quantity: Number(row.quantity || 1), unit: row.unit || 'ks', is_completed: Boolean(row.completed)
    };
    if (row.server_id) {
      const { error } = await db.from('shopping_list_items').update(payload).eq('id', row.server_id);
      if (error) throw error;
    } else {
      const { data, error } = await db.from('shopping_list_items').insert(payload).select('id').single();
      if (error) throw error;
      row.server_id = data.id;
      saveLocal();
    }
  }

  async function deleteRow(row) {
    rows = rows.filter((item) => item.local_id !== row.local_id);
    saveLocal();
    if (session && row.server_id) {
      const { error } = await db.from('shopping_list_items').delete().eq('id', row.server_id);
      if (error) throw error;
    }
  }

  async function fetchOffers() {
    const productIds = [...new Set(rows.filter((row) => !row.completed).map((row) => row.product_id).filter(Boolean))];
    if (!productIds.length) { activeOffers = []; renderResults(); return; }
    const { data, error } = await db.from('offers')
      .select('id,product_id,store_id,title,price,old_price,unit_price,unit_price_unit,valid_from,valid_to,stores(id,name,slug),products(id,name,brand,quantity_text,image_url)')
      .in('product_id', productIds).eq('status', 'published').lte('valid_from', upcomingTo).gte('valid_to', today).limit(5000);
    if (error) throw error;
    activeOffers = data || [];
    renderResults();
  }

  function cheapestFor(productId, allowedStores = null) {
    const candidates = activeOffers.filter((offer) => offer.product_id === productId && (!allowedStores || allowedStores.has(offer.store_id)));
    const current = candidates.filter((offer) => String(offer.valid_from || '') <= today);
    return (current.length ? current : candidates).sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
  }

  function planFromOffers(items, allowedStores = null) {
    const chosen = [];
    let total = 0;
    for (const item of items) {
      const offer = cheapestFor(item.product_id, allowedStores);
      if (!offer) return null;
      const qty = Math.max(.01, Number(item.quantity || 1));
      total += Number(offer.price || 0) * qty;
      chosen.push({ item, offer, subtotal: Number(offer.price || 0) * qty });
    }
    const stores = [...new Map(chosen.map((row) => [row.offer.store_id, row.offer.stores])).values()];
    return { total, chosen, stores, upcomingCount: chosen.filter((row) => String(row.offer.valid_from || '') > today).length };
  }

  function calculatePlans() {
    const items = rows.filter((row) => !row.completed && row.product_id);
    if (!items.length) return { items, absolute: null, oneStore: null, balanced: null };
    const absolute = planFromOffers(items);
    const storeIds = [...new Set(activeOffers.map((offer) => offer.store_id))];

    let oneStore = null;
    for (const storeId of storeIds) {
      const plan = planFromOffers(items, new Set([storeId]));
      if (plan && (!oneStore || plan.total < oneStore.total)) oneStore = plan;
    }

    let balanced = oneStore;
    let balancedScore = oneStore ? oneStore.total : Infinity;
    for (let i = 0; i < storeIds.length; i++) {
      for (let j = i; j < storeIds.length; j++) {
        const plan = planFromOffers(items, new Set([storeIds[i], storeIds[j]]));
        if (!plan) continue;
        const score = plan.total + Math.max(0, plan.stores.length - 1) * 35;
        if (score < balancedScore) { balanced = plan; balancedScore = score; }
      }
    }
    return { items, absolute, oneStore, balanced };
  }

  function planHtml(title, plan, description, best = false) {
    if (!plan) return `<div class="sfResultBox"><h3>${esc(title)}</h3><p class="sfMuted">Pro tuto variantu zatím chybí dostatek cen.</p></div>`;
    const groups = new Map();
    plan.chosen.forEach(({ item, offer, subtotal }) => {
      const name = offer.stores?.name || 'Obchod';
      const group = groups.get(name) || [];
      group.push(`${item.name} – ${money(subtotal)} Kč`);
      groups.set(name, group);
    });
    const upcoming = plan.upcomingCount ? ` ${plan.upcomingCount} položek používá akci začínající během příštích 7 dnů.` : '';
    return `<div class="sfResultBox ${best ? 'best' : ''}"><h3>${esc(title)}</h3><div class="sfResultPrice">${money(plan.total)} Kč</div><p class="sfMuted">${esc(description + upcoming)}</p><div class="sfStoreTags">${[...groups].map(([store, lines]) => `<span class="sfStoreTag" title="${esc(lines.join('\n'))}">${esc(store)} · ${lines.length} položek</span>`).join('')}</div></div>`;
  }

  function renderResults() {
    const plans = calculatePlans();
    const customCount = rows.filter((row) => !row.completed && !row.product_id).length;
    $('optimizer').innerHTML = plans.items.length
      ? `${planHtml('Vše v jednom obchodě', plans.oneStore, 'Nejméně cestování. Všechny porovnávané položky koupíš na jednom místě.')}${planHtml('Absolutně nejnižší cena', plans.absolute, `Nejnižší cena každé položky. ${plans.absolute?.stores.length || 0} zastávek.`)}${planHtml('Nejlepší poměr cena a cesta', plans.balanced, 'Do výpočtu se započítává penalizace 35 Kč za každou další zastávku.', true)}${customCount ? `<p class="sfMuted">${customCount} vlastních položek nemá produktové propojení a není započítáno do cen.</p>` : ''}`
      : '<div class="sfEmpty">Přidej akční produkty z domovské stránky nebo vlastní položky.</div>';
  }

  function render() {
    const active = rows.filter((row) => !row.completed);
    $('listCount').textContent = `${active.length} položek`;
    $('listItems').innerHTML = rows.length ? rows.map((row) => `
      <article class="sfListItem ${row.completed ? 'done' : ''}" data-id="${esc(row.local_id)}">
        <input class="sfCheck" type="checkbox" data-complete ${row.completed ? 'checked' : ''} aria-label="Označit jako koupené">
        <div><div class="sfItemName">${esc(row.name || row.custom_name || 'Položka')}</div><div class="sfItemMeta">${esc([row.brand,row.quantity_text,row.store_name].filter(Boolean).join(' · ') || (row.product_id ? 'Produkt Slevao.cz' : 'Vlastní položka'))}</div></div>
        <input class="sfInput" type="number" min="0.01" step="0.01" value="${esc(row.quantity || 1)}" data-quantity aria-label="Množství">
        <button class="sfIconButton" type="button" data-delete aria-label="Odstranit">×</button>
      </article>`).join('') : '<div class="sfEmpty">Seznam je prázdný.</div>';
    renderResults();
    saveLocal();
  }

  async function addCustom() {
    const name = $('customName').value.trim();
    const quantity = Math.max(.01, Number($('customQuantity').value || 1));
    if (!name) { $('customName').focus(); return; }
    const existing = rows.find((row) => !row.product_id && norm(row.custom_name || row.name) === norm(name) && !row.completed);
    if (existing) existing.quantity = Number(existing.quantity || 1) + quantity;
    else rows.push({ local_id: uid(), key: `c:${norm(name)}`, product_id: null, selected_offer_id: null, custom_name: name, name, quantity, unit: 'ks', completed: false, added_at: new Date().toISOString() });
    $('customName').value = '';
    $('customQuantity').value = '1';
    const row = existing || rows.at(-1);
    render();
    try { await persistRow(row); } catch (error) { showMessage(error.message, true); }
  }

  function showMessage(text, bad = false) {
    $('listMessage').textContent = text;
    $('listMessage').style.color = bad ? '#b32631' : '#0b7a58';
  }

  async function shareList() {
    const lines = rows.filter((row) => !row.completed).map((row) => `${row.quantity || 1}× ${row.name || row.custom_name}`);
    if (!lines.length) { showMessage('Seznam je prázdný.', true); return; }
    const text = `Nákupní seznam Slevao.cz\n\n${lines.join('\n')}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Nákupní seznam Slevao.cz', text });
      else { await navigator.clipboard.writeText(text); showMessage('Seznam byl zkopírován do schránky.'); }
    } catch (error) { if (error.name !== 'AbortError') showMessage('Sdílení se nepodařilo.', true); }
  }

  async function init() {
    rows = readLocal();
    const { data: { session: current } } = await db.auth.getSession();
    session = current;
    $('accountStatus').innerHTML = session
      ? `Přihlášen jako <strong>${esc(session.user.email)}</strong> · seznam se synchronizuje.`
      : 'Seznam je uložen v tomto zařízení. <a href="ucet.html?redirect=seznam.html">Přihlásit a synchronizovat</a>.';
    if (session) {
      try { await mergeRemote(); showMessage('Seznam je synchronizovaný s účtem.'); }
      catch (error) { showMessage(`Synchronizace se nepodařila: ${error.message}`, true); }
    }
    render();
    try { await fetchOffers(); } catch (error) { showMessage(`Ceny se nepodařilo načíst: ${error.message}`, true); }
  }

  $('addCustom').addEventListener('click', addCustom);
  $('customName').addEventListener('keydown', (event) => { if (event.key === 'Enter') addCustom(); });
  $('shareList').addEventListener('click', shareList);
  $('clearCompleted').addEventListener('click', async () => {
    const completed = rows.filter((row) => row.completed);
    rows = rows.filter((row) => !row.completed);
    saveLocal(); render();
    if (session) {
      const ids = completed.map((row) => row.server_id).filter(Boolean);
      if (ids.length) await db.from('shopping_list_items').delete().in('id', ids);
    }
  });

  $('listItems').addEventListener('change', async (event) => {
    const article = event.target.closest('[data-id]');
    const row = rows.find((item) => item.local_id === article?.dataset.id);
    if (!row) return;
    if (event.target.matches('[data-complete]')) row.completed = event.target.checked;
    if (event.target.matches('[data-quantity]')) row.quantity = Math.max(.01, Number(event.target.value || 1));
    row.updated_at = new Date().toISOString();
    render();
    try { await persistRow(row); await fetchOffers(); } catch (error) { showMessage(error.message, true); }
  });

  $('listItems').addEventListener('click', async (event) => {
    if (!event.target.closest('[data-delete]')) return;
    const article = event.target.closest('[data-id]');
    const row = rows.find((item) => item.local_id === article?.dataset.id);
    if (!row) return;
    try { await deleteRow(row); render(); await fetchOffers(); } catch (error) { showMessage(error.message, true); }
  });

  init();
})();
