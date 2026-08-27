(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const HISTORY_KEY = 'slevao-shopping-history-v1';
  const BUDGET_KEY = 'slevao-shopping-budget-v1';
  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || !document.querySelector('.sfListLayout')) return;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const sharedToken = hash.get('share') || query.get('share') || '';
  const sharedMode = Boolean(sharedToken);

  let session = null;
  let list = null;
  let rows = [];
  let history = [];
  let budget = 0;
  let metrics = blankMetrics();
  let lastSignature = '';
  let lastBusinessDay = '';
  let busy = false;

  function safeJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function localRows() {
    const value = safeJson(LIST_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function localHistory() {
    const value = safeJson(HISTORY_KEY, []);
    return Array.isArray(value) ? value.slice(0, 30) : [];
  }

  function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
  }

  function localBudget() {
    const value = Number(localStorage.getItem(BUDGET_KEY) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function blankMetrics() {
    return {
      total: 0,
      referenceTotal: 0,
      savings: 0,
      storesCount: 0,
      itemCount: 0,
      linkedCount: 0,
      missingCount: 0,
      customCount: 0,
      customResolvedCount: 0,
      upcomingCount: 0,
      snapshots: []
    };
  }

  function injectUi() {
    if ($('shoppingInsights')) return;
    const layout = document.querySelector('.sfListLayout');
    const insights = document.createElement('section');
    insights.id = 'shoppingInsights';
    insights.className = 'sfInsights';
    insights.innerHTML = `
      <div class="sfInsightsCard">
        <div class="sfInsightsHead"><div><span class="sfEyebrow">Rozpočet a úspora</span><h2>Kolik tě nákup vyjde</h2><p>Počítá se nejnižší platná cena, případně nejbližší akce během sedmi dnů.</p></div></div>
        <div class="sfBudgetRow">
          <label class="sfBudgetField" for="shoppingBudget">Rozpočet nákupu<span class="sfBudgetInputWrap"><input id="shoppingBudget" type="number" min="0" step="50" placeholder="Bez limitu"><span>Kč</span></span></label>
          <div><div id="shoppingBudgetProgress" class="sfBudgetProgress"><i></i></div><div id="shoppingBudgetNote" class="sfBudgetNote">Nastav rozpočet a Slevao pohlídá limit.</div></div>
        </div>
        <div class="sfInsightsStats">
          <div class="sfInsightStat"><small>Odhad nákupu</small><strong id="insightTotal">0 Kč</strong></div>
          <div class="sfInsightStat saving"><small>Odhad úspory</small><strong id="insightSavings">0 Kč</strong></div>
          <div class="sfInsightStat"><small>Obchody</small><strong id="insightStores">0</strong></div>
          <div class="sfInsightStat"><small>Započítané položky</small><strong id="insightItems">0</strong></div>
        </div>
        <div class="sfInsightActions"><button id="completeShopping" class="sfButton sfCompleteButton" type="button">Dokončit nákup a uložit historii</button><button id="refreshShoppingInsights" class="sfButton" type="button">Přepočítat</button></div>
        <p id="shoppingInsightsHint" class="sfInsightsHint"></p>
      </div>`;
    layout.parentNode.insertBefore(insights, layout);

    const historySection = document.createElement('section');
    historySection.id = 'shoppingHistorySection';
    historySection.className = 'sfInsights';
    historySection.innerHTML = `
      <div class="sfInsightsCard">
        <div class="sfInsightsHead"><div><span class="sfEyebrow">Opakované nákupy</span><h2>Historie nákupů</h2><p>Dokončený nákup můžeš vložit zpět do seznamu s aktuálními cenami.</p></div></div>
        <div id="shoppingHistory" class="sfHistoryGrid"><div class="sfInsightsLoading">Načítám historii…</div></div>
      </div>`;
    layout.parentNode.insertBefore(historySection, layout.nextSibling);

    $('shoppingBudget').addEventListener('change', saveBudget);
    $('shoppingBudget').addEventListener('blur', saveBudget);
    $('completeShopping').addEventListener('click', completeShopping);
    $('refreshShoppingInsights').addEventListener('click', () => refreshAll(true));
    $('shoppingHistory').addEventListener('click', handleHistoryClick);
  }

  async function loadIdentity() {
    const { data: { session: current } } = await db.auth.getSession();
    session = current || null;
    budget = localBudget();
    if (sharedMode || !session) return;

    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await db.from('shopping_lists')
        .select('id,name,budget,created_at')
        .eq('user_id', session.user.id)
        .eq('is_archived', false)
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        list = data;
        budget = Number(data.budget || budget || 0);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async function loadRows() {
    if (!sharedMode) {
      rows = localRows();
      return;
    }
    const { data, error } = await db.rpc('get_shared_shopping_list', { p_token: sharedToken });
    if (error) throw error;
    budget = Number(data?.budget || 0);
    rows = (Array.isArray(data?.items) ? data.items : []).map((item) => ({
      product_id: item.product_id || null,
      selected_offer_id: item.selected_offer_id || null,
      custom_name: item.custom_name || null,
      name: item.name || item.custom_name || 'Položka',
      brand: item.brand || null,
      quantity_text: item.quantity_text || null,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'ks',
      completed: Boolean(item.is_completed)
    }));
  }

  async function loadHistory() {
    if (sharedMode) {
      history = [];
      return;
    }
    if (!session) {
      history = localHistory();
      return;
    }
    const { data, error } = await db.from('shopping_list_purchases')
      .select('id,name,planned_total,reference_total,savings,budget,stores_count,item_count,items,completed_at')
      .eq('user_id', session.user.id)
      .order('completed_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    history = data || [];
  }

  function chooseOffer(offers, productId, today = pragueDate()) {
    const candidates = offers
      .filter((offer) => String(offer.product_id) === String(productId))
      .filter((offer) => !offer.valid_to || String(offer.valid_to) >= today);
    const current = candidates.filter((offer) => !offer.valid_from || String(offer.valid_from) <= today);
    return (current.length ? current : candidates).slice().sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0] || null;
  }

  function chooseCustomOffer(offers, today = pragueDate()) {
    const candidates = (Array.isArray(offers) ? offers : [])
      .filter((offer) => Number(offer?.price || 0) > 0)
      .filter((offer) => !offer.valid_to || String(offer.valid_to) >= today);
    const current = candidates.filter((offer) => !offer.valid_from || String(offer.valid_from) <= today);
    return (current.length ? current : candidates).slice().sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0] || null;
  }

  async function calculate() {
    const today = pragueDate();
    const upcomingTo = addCalendarDays(today, 7);
    const active = rows.filter((row) => !row.completed && !row.is_completed);
    const ids = [...new Set(active.map((row) => row.product_id).filter(Boolean).map(String))];
    const customQueries = [...new Set(active
      .filter((row) => !row.product_id)
      .map((row) => String(row.custom_name || row.name || '').trim())
      .filter(Boolean))];

    const productPromise = ids.length
      ? db.from('offers')
        .select('id,product_id,store_id,title,price,old_price,valid_from,valid_to,stores(id,name,slug)')
        .in('product_id', ids)
        .eq('status', 'published')
        .gte('valid_to', today)
        .lte('valid_from', upcomingTo)
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
    const offers = productResult.data || [];
    const customOfferMap = new Map();
    for (const candidate of customResult.data || []) {
      const key = String(candidate.query_key || norm(candidate.query_text));
      if (!key || !candidate.offer) continue;
      const matches = customOfferMap.get(key) || [];
      matches.push(candidate.offer);
      customOfferMap.set(key, matches);
    }

    const next = blankMetrics();
    const stores = new Set();
    next.itemCount = active.length;

    for (const row of active) {
      const quantity = Math.max(0.01, Number(row.quantity || 1));
      const base = {
        product_id: row.product_id || null,
        custom_name: row.product_id ? null : (row.custom_name || row.name || 'Položka'),
        name: row.name || row.custom_name || 'Položka',
        brand: row.brand || null,
        quantity_text: row.quantity_text || null,
        quantity,
        unit: row.unit || 'ks'
      };

      let offer = null;
      if (!row.product_id) {
        next.customCount++;
        offer = chooseCustomOffer(customOfferMap.get(norm(row.custom_name || row.name)) || [], today);
        if (!offer) {
          next.snapshots.push({ ...base, offer_id: null, price: null, old_price: null, store_id: null, store_name: null, subtotal: null, reference_subtotal: null });
          continue;
        }
        next.customResolvedCount++;
      } else {
        offer = chooseOffer(offers, row.product_id, today);
        if (!offer) {
          next.missingCount++;
          next.snapshots.push({ ...base, offer_id: null, price: null, old_price: null, store_id: null, store_name: null, subtotal: null, reference_subtotal: null });
          continue;
        }
      }

      const price = Math.max(0, Number(offer.price || 0));
      const oldPrice = Number(offer.old_price || 0) > price ? Number(offer.old_price) : price;
      const subtotal = price * quantity;
      const referenceSubtotal = oldPrice * quantity;
      next.total += subtotal;
      next.referenceTotal += referenceSubtotal;
      next.linkedCount++;
      if (offer.store_id) stores.add(String(offer.store_id));
      if (String(offer.valid_from || '') > today) next.upcomingCount++;
      next.snapshots.push({
        ...base,
        offer_id: offer.id,
        price,
        old_price: oldPrice > price ? oldPrice : null,
        store_id: offer.store_id || null,
        store_name: offer.stores?.name || null,
        subtotal: Number(subtotal.toFixed(2)),
        reference_subtotal: Number(referenceSubtotal.toFixed(2)),
        valid_from: offer.valid_from || null,
        valid_to: offer.valid_to || null
      });
    }

    next.storesCount = stores.size;
    next.total = Number(next.total.toFixed(2));
    next.referenceTotal = Number(next.referenceTotal.toFixed(2));
    next.savings = Number(Math.max(0, next.referenceTotal - next.total).toFixed(2));
    metrics = next;
  }

  function renderBudget() {
    const input = $('shoppingBudget');
    const progress = $('shoppingBudgetProgress');
    const bar = progress.querySelector('i');
    const note = $('shoppingBudgetNote');
    input.value = budget > 0 ? String(Number(budget.toFixed(2))) : '';
    input.disabled = sharedMode;

    if (!budget) {
      progress.classList.remove('over');
      bar.style.width = '0%';
      note.className = 'sfBudgetNote';
      note.textContent = sharedMode ? 'Vlastník seznamu zatím nenastavil rozpočet.' : 'Nastav rozpočet a Slevao pohlídá limit.';
      return;
    }

    const remaining = budget - metrics.total;
    progress.classList.toggle('over', remaining < 0);
    bar.style.width = `${Math.min(100, Math.max(0, metrics.total / budget * 100))}%`;
    note.className = `sfBudgetNote ${remaining >= 0 ? 'good' : 'bad'}`;
    note.textContent = remaining >= 0
      ? `Do rozpočtu zbývá přibližně ${money(remaining)} Kč.`
      : `Rozpočet je překročen přibližně o ${money(Math.abs(remaining))} Kč.`;
  }

  function renderMetrics() {
    $('insightTotal').textContent = `${money(metrics.total)} Kč`;
    $('insightSavings').textContent = `${money(metrics.savings)} Kč`;
    $('insightStores').textContent = String(metrics.storesCount);
    $('insightItems').textContent = `${metrics.linkedCount}/${metrics.itemCount}`;
    const hints = [];
    const unresolvedCustomCount = Math.max(0, metrics.customCount - metrics.customResolvedCount);
    if (unresolvedCustomCount) hints.push(`${unresolvedCustomCount} vlastních položek nemá spolehlivě nalezenou cenu a není zahrnuto do odhadu.`);
    if (metrics.missingCount) hints.push(`U ${metrics.missingCount} produktů se nepodařilo najít platnou ani brzy začínající cenu.`);
    if (metrics.upcomingCount) hints.push(`${metrics.upcomingCount} položek používá akci začínající během příštích sedmi dnů.`);
    if (!hints.length && metrics.itemCount) hints.push('Všechny položky mají nalezenou cenu.');
    if (!metrics.itemCount) hints.push('Přidej položky do seznamu a odhad se vypočítá automaticky.');
    $('shoppingInsightsHint').textContent = hints.join(' ');
    $('completeShopping').disabled = sharedMode || !metrics.itemCount || busy;
    $('completeShopping').title = sharedMode ? 'Sdílený nákup může dokončit pouze vlastník seznamu.' : '';
    renderBudget();
  }

  function formatDate(value) {
    return value
      ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
      : 'Neznámé datum';
  }

  function renderHistory() {
    const container = $('shoppingHistory');
    if (sharedMode) {
      container.innerHTML = '<div class="sfHistoryEmpty">Historie je dostupná pouze vlastníkovi seznamu.</div>';
      return;
    }
    if (!history.length) {
      container.innerHTML = '<div class="sfHistoryEmpty">Zatím tu není dokončený nákup. Až nakoupíš, ulož ho tlačítkem výše.</div>';
      return;
    }
    container.innerHTML = history.map((purchase) => `
      <article class="sfHistoryCard" data-purchase-id="${esc(purchase.id)}">
        <h3>${esc(purchase.name || 'Dokončený nákup')}</h3>
        <div class="sfHistoryDate">${esc(formatDate(purchase.completed_at))}</div>
        <div class="sfHistoryTotal"><strong>${money(purchase.planned_total)} Kč</strong>${Number(purchase.savings || 0) > 0 ? `<span class="sfHistorySaving">Úspora ${money(purchase.savings)} Kč</span>` : ''}</div>
        <div class="sfHistoryMeta">${Number(purchase.item_count || 0)} položek · ${Number(purchase.stores_count || 0)} obchodů${purchase.budget ? ` · rozpočet ${money(purchase.budget)} Kč` : ''}</div>
        <div class="sfHistoryActions"><button class="sfButton primary" type="button" data-repeat-purchase>Zopakovat nákup</button><button class="sfButton" type="button" data-delete-purchase>Odstranit</button></div>
      </article>`).join('');
  }

  async function saveBudget() {
    if (sharedMode) return;
    const value = Math.max(0, Number($('shoppingBudget').value || 0));
    budget = Number.isFinite(value) ? value : 0;
    if (budget) localStorage.setItem(BUDGET_KEY, String(budget));
    else localStorage.removeItem(BUDGET_KEY);

    if (session && list?.id) {
      const { error } = await db.from('shopping_lists')
        .update({ budget: budget || null, updated_at: new Date().toISOString() })
        .eq('id', list.id)
        .eq('user_id', session.user.id);
      if (error) throw error;
      list.budget = budget || null;
    }
    renderBudget();
    window.SlevaoPublic?.toast?.(budget ? 'Rozpočet byl uložen.' : 'Rozpočet byl zrušen.');
  }

  function purchasePayload() {
    return {
      id: crypto.randomUUID?.() || `local-${Date.now()}`,
      name: `Nákup ${formatDate(new Date().toISOString())}`,
      planned_total: metrics.total,
      reference_total: metrics.referenceTotal,
      savings: metrics.savings,
      budget: budget || null,
      stores_count: metrics.storesCount,
      item_count: metrics.itemCount,
      items: metrics.snapshots,
      completed_at: new Date().toISOString()
    };
  }

  async function completeShopping() {
    if (sharedMode || busy || !metrics.itemCount) return;
    if (!window.confirm(`Uložit nákup za přibližně ${money(metrics.total)} Kč do historie a vyčistit seznam?`)) return;
    busy = true;
    renderMetrics();

    try {
      const purchase = purchasePayload();
      if (session) {
        const { data, error } = await db.from('shopping_list_purchases').insert({
          user_id: session.user.id,
          shopping_list_id: list?.id || null,
          name: purchase.name,
          planned_total: purchase.planned_total,
          reference_total: purchase.reference_total,
          savings: purchase.savings,
          budget: purchase.budget,
          stores_count: purchase.stores_count,
          item_count: purchase.item_count,
          items: purchase.items,
          completed_at: purchase.completed_at
        }).select('id').single();
        if (error) throw error;
        purchase.id = data.id;
        if (list?.id) {
          const { error: deleteError } = await db.from('shopping_list_items').delete().eq('shopping_list_id', list.id);
          if (deleteError) throw deleteError;
          try { await db.rpc('revoke_shopping_list_shares', { p_list_id: list.id }); } catch {}
        }
      } else {
        history = [purchase, ...localHistory()].slice(0, 30);
        saveHistory();
      }

      localStorage.setItem(LIST_KEY, '[]');
      window.SlevaoPublic?.updateNavCount?.();
      window.SlevaoPublic?.toast?.('Nákup byl uložen do historie.');
      window.setTimeout(() => location.reload(), 450);
    } catch (error) {
      busy = false;
      renderMetrics();
      window.SlevaoPublic?.toast?.(error.message || 'Nákup se nepodařilo uložit.');
    }
  }

  function rowFromSnapshot(item) {
    return {
      local_id: crypto.randomUUID?.() || `row-${Date.now()}-${Math.random()}`,
      product_id: item.product_id || null,
      selected_offer_id: null,
      custom_name: item.product_id ? null : (item.custom_name || item.name),
      name: item.name || item.custom_name || 'Položka',
      brand: item.brand || null,
      quantity_text: item.quantity_text || null,
      quantity: Math.max(0.01, Number(item.quantity || 1)),
      unit: item.unit || 'ks',
      completed: false,
      added_at: new Date().toISOString()
    };
  }

  async function repeatPurchase(purchase) {
    const items = Array.isArray(purchase?.items) ? purchase.items : [];
    if (!items.length) return;
    const current = localRows();
    const map = new Map(current.map((row) => [row.product_id ? `p:${row.product_id}` : `c:${norm(row.custom_name || row.name)}`, row]));
    for (const item of items) {
      const key = item.product_id ? `p:${item.product_id}` : `c:${norm(item.custom_name || item.name)}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity = Number(existing.quantity || 0) + Math.max(0.01, Number(item.quantity || 1));
        existing.completed = false;
      } else {
        const row = rowFromSnapshot(item);
        current.push(row);
        map.set(key, row);
      }
    }
    localStorage.setItem(LIST_KEY, JSON.stringify(current));
    window.SlevaoPublic?.updateNavCount?.();
    window.SlevaoPublic?.toast?.('Položky byly vráceny do nákupního seznamu.');
    window.setTimeout(() => location.reload(), 350);
  }

  async function deletePurchase(purchase) {
    if (!window.confirm('Odstranit tento nákup z historie?')) return;
    if (session) {
      const { error } = await db.from('shopping_list_purchases').delete().eq('id', purchase.id).eq('user_id', session.user.id);
      if (error) throw error;
    }
    history = history.filter((row) => String(row.id) !== String(purchase.id));
    if (!session) saveHistory();
    renderHistory();
  }

  async function handleHistoryClick(event) {
    const card = event.target.closest('[data-purchase-id]');
    if (!card) return;
    const purchase = history.find((row) => String(row.id) === String(card.dataset.purchaseId));
    if (!purchase) return;
    try {
      if (event.target.closest('[data-repeat-purchase]')) await repeatPurchase(purchase);
      if (event.target.closest('[data-delete-purchase]')) await deletePurchase(purchase);
    } catch (error) {
      window.SlevaoPublic?.toast?.(error.message || 'Operace se nepodařila.');
    }
  }

  function signature() {
    return `${localStorage.getItem(LIST_KEY) || '[]'}:${localStorage.getItem(BUDGET_KEY) || ''}`;
  }

  async function refreshAll(force = false) {
    if (busy) return;
    const businessDay = pragueDate();
    if (!sharedMode) {
      const current = signature();
      if (!force && current === lastSignature && businessDay === lastBusinessDay) return;
      lastSignature = current;
    }
    lastBusinessDay = businessDay;
    try {
      await loadRows();
      await calculate();
      renderMetrics();
      if (sharedMode) renderHistory();
    } catch (error) {
      $('shoppingInsightsHint').textContent = error.message || 'Odhad nákupu se nepodařilo vypočítat.';
    }
  }

  async function init() {
    injectUi();
    await loadIdentity();
    await Promise.all([loadRows(), loadHistory()]);
    await calculate();
    renderMetrics();
    renderHistory();
    lastSignature = signature();
    lastBusinessDay = pragueDate();
    const timer = window.setInterval(() => refreshAll(false), sharedMode ? 5000 : 2500);
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
    window.addEventListener('storage', () => refreshAll(true));
  }

  init().catch((error) => {
    injectUi();
    if ($('shoppingInsightsHint')) $('shoppingInsightsHint').textContent = error.message || 'Přehled nákupu se nepodařilo načíst.';
  });
})();