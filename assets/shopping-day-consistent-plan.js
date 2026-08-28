(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const REFRESH_MS = 5 * 60 * 1000;
  const list = document.getElementById('listItems');
  const optimizer = document.getElementById('optimizer');
  const db = window.SlevaoSupabase?.getClient?.();
  if (!list || !optimizer || !db) return;

  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedToken = hash.get('share') || query.get('share') || '';
  const sharedMode = Boolean(sharedToken);
  let refreshing = false;
  let rerunRequested = false;
  let queued = 0;
  let lastSignature = '';
  let lastRefreshAt = 0;
  let lastHtml = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { minimumFractionDigits:2, maximumFractionDigits:2 });

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

  function dateLabel(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return String(dateKey || '');
    return new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric', timeZone:'Europe/Prague' })
      .format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function validOn(offer, dateKey) {
    const from = String(offer?.valid_from || '');
    const to = String(offer?.valid_to || '');
    return (!from || from <= dateKey) && (!to || to >= dateKey);
  }

  function cheapestOnDate(offers, dateKey) {
    return (offers || [])
      .filter((offer) => validOn(offer, dateKey) && Number(offer?.price) > 0)
      .slice()
      .sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
  }

  function planForDate(rows, offerLists, dateKey) {
    const chosen = [];
    let total = 0;
    for (const row of rows) {
      const offer = cheapestOnDate(offerLists.get(row.key) || [], dateKey);
      if (!offer) return null;
      const quantity = Math.max(0.01, Number(row.quantity || 1));
      const subtotal = Number(offer.price) * quantity;
      total += subtotal;
      chosen.push({ row, offer, subtotal });
    }
    return { dateKey, total, chosen };
  }

  function bestDayPlan(rows, offerLists, today) {
    let best = null;
    for (let offset = 0; offset <= 7; offset++) {
      const dateKey = addCalendarDays(today, offset);
      const plan = planForDate(rows, offerLists, dateKey);
      if (!plan) continue;
      if (!best || plan.total < best.total || (plan.total === best.total && plan.dateKey < best.dateKey)) best = plan;
    }
    return best;
  }

  async function readRows() {
    if (sharedMode) {
      const { data, error } = await db.rpc('get_shared_shopping_list', { p_token:sharedToken });
      if (error) throw error;
      return (Array.isArray(data?.items) ? data.items : []).map((row) => ({
        key:String(row.id || `${row.product_id || ''}:${row.custom_name || ''}`),
        product_id:row.product_id || null,
        custom_name:row.custom_name || null,
        name:row.name || row.custom_name || 'Položka',
        quantity:Number(row.quantity || 1),
        completed:Boolean(row.is_completed)
      }));
    }
    try {
      const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        key:String(row.local_id || row.server_id || `${row.product_id || ''}:${row.custom_name || row.name || ''}`),
        product_id:row.product_id || null,
        custom_name:row.custom_name || null,
        name:row.name || row.custom_name || 'Položka',
        quantity:Number(row.quantity || 1),
        completed:Boolean(row.completed)
      }));
    } catch {
      return [];
    }
  }

  function rowSignature(rows, today) {
    return `${today}|${rows.map((row) => [row.key,row.product_id || '',norm(row.custom_name || row.name),Number(row.quantity || 1),row.completed ? 1 : 0].join(':')).sort().join('|')}`;
  }

  async function fetchOfferLists(rows, today) {
    const upcomingTo = addCalendarDays(today, 7);
    const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean))];
    const customQueries = [...new Set(rows.filter((row) => !row.product_id).map((row) => String(row.custom_name || row.name || '').trim()).filter(Boolean))];
    const productPromise = productIds.length
      ? db.from('offers')
        .select('id,product_id,store_id,title,price,valid_from,valid_to,stores(id,name,slug)')
        .in('product_id', productIds)
        .eq('status', 'published')
        .lte('valid_from', upcomingTo)
        .gte('valid_to', today)
        .limit(5000)
      : Promise.resolve({ data:[], error:null });
    const customPromise = customQueries.length
      ? db.rpc('get_public_shopping_list_candidates', { p_queries:customQueries, p_limit_per_query:30 })
      : Promise.resolve({ data:[], error:null });
    const [productResult, customResult] = await Promise.all([productPromise, customPromise]);
    if (productResult.error) throw productResult.error;
    if (customResult.error) throw customResult.error;

    const byProduct = new Map();
    for (const offer of productResult.data || []) {
      const key = String(offer.product_id || '');
      if (!key) continue;
      const bucket = byProduct.get(key) || [];
      bucket.push(offer);
      byProduct.set(key, bucket);
    }
    const byCustom = new Map();
    for (const candidate of customResult.data || []) {
      let offer = candidate?.offer;
      if (typeof offer === 'string') {
        try { offer = JSON.parse(offer); } catch { offer = null; }
      }
      if (!offer) continue;
      const key = norm(candidate?.query_key || candidate?.query_text || '');
      if (!key) continue;
      const bucket = byCustom.get(key) || [];
      bucket.push(offer);
      byCustom.set(key, bucket);
    }

    const offerLists = new Map();
    rows.forEach((row) => {
      offerLists.set(row.key, row.product_id
        ? (byProduct.get(String(row.product_id)) || [])
        : (byCustom.get(norm(row.custom_name || row.name)) || []));
    });
    return offerLists;
  }

  function storeName(offer) {
    if (Array.isArray(offer?.stores)) return String(offer.stores[0]?.name || 'Obchod');
    return String(offer?.stores?.name || offer?.store_name || 'Obchod');
  }

  function planHtml(plan, pricedCount, totalCount) {
    const groups = new Map();
    plan.chosen.forEach(({ row, offer, subtotal }) => {
      const key = String(offer.store_id || storeName(offer));
      const group = groups.get(key) || { name:storeName(offer), lines:[] };
      group.lines.push(`${row.name} – ${money(subtotal)} Kč`);
      groups.set(key, group);
    });
    const tags = [...groups.values()].map((group) => (
      `<span class="sfStoreTag" title="${esc(group.lines.join('\n'))}">${esc(group.name)}</span>`
    )).join('');
    const coverage = pricedCount === totalCount
      ? `Všechny uvedené ceny platí současně ${dateLabel(plan.dateKey)}.`
      : `Ceny platí současně ${dateLabel(plan.dateKey)} · nalezeno u ${pricedCount} z ${totalCount} položek.`;
    return `<h3>Nejlevnější nákup v jeden den</h3><div class="sfResultPrice">${money(plan.total)} Kč</div><div class="sfStoreTags">${tags}</div><p class="sfMuted">${esc(coverage)}</p>`;
  }

  function renderCard(html) {
    let box = optimizer.querySelector('[data-day-consistent-plan="true"]');
    if (!html) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'sfResultBox best';
      box.dataset.dayConsistentPlan = 'true';
      optimizer.prepend(box);
    }
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  function commitResult(signature, html) {
    lastSignature = signature;
    lastRefreshAt = Date.now();
    lastHtml = html;
    renderCard(lastHtml);
  }

  function clearFailedResult() {
    lastSignature = '';
    lastRefreshAt = 0;
    lastHtml = '';
    renderCard('');
  }

  async function refresh({ force = false } = {}) {
    if (refreshing) {
      rerunRequested = true;
      return;
    }
    if (document.hidden) return;
    refreshing = true;
    try {
      const today = pragueDate();
      const sourceRows = await readRows();
      const activeRows = sourceRows.filter((row) => !row.completed);
      const signature = rowSignature(activeRows, today);
      if (!force && signature === lastSignature && Date.now() - lastRefreshAt < REFRESH_MS) {
        renderCard(lastHtml);
        return;
      }
      if (!activeRows.length) {
        commitResult(signature, '');
        return;
      }

      const offerLists = await fetchOfferLists(activeRows, today);
      const priceable = activeRows.filter((row) => (offerLists.get(row.key) || []).some((offer) => {
        for (let offset = 0; offset <= 7; offset++) if (validOn(offer, addCalendarDays(today, offset))) return true;
        return false;
      }));
      if (!priceable.length) {
        commitResult(signature, '');
        return;
      }
      const plan = bestDayPlan(priceable, offerLists, today);
      commitResult(signature, plan ? planHtml(plan, priceable.length, activeRows.length) : '');
    } catch (error) {
      clearFailedResult();
      console.debug('Day-consistent shopping plan failed:', error);
    } finally {
      refreshing = false;
      if (rerunRequested) {
        rerunRequested = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (queued) clearTimeout(queued);
    queued = window.setTimeout(() => {
      queued = 0;
      refresh().catch(() => {});
    }, 180);
  }

  new MutationObserver(schedule).observe(list, { childList:true, subtree:true });
  window.addEventListener('focus', () => {
    if (Date.now() - lastRefreshAt >= REFRESH_MS) refresh({ force:true }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastRefreshAt >= REFRESH_MS) refresh({ force:true }).catch(() => {});
  });
  schedule();
})();
