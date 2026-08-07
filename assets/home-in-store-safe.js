(() => {
  'use strict';

  const CACHE_MS = 30000;
  let safeCache = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const api = () => window.SlevaoLocation || null;

  function meaningfulTitle(value) {
    const text = fold(value);
    if (text.length < 4) return false;
    const blocked = new Set(['cena', 'akce', 'sleva', 'vybrane druhy', 's klubem', 'club', 'original', 'mini']);
    if (blocked.has(text)) return false;
    if (/^\d+$/.test(text)) return false;
    return true;
  }

  function packageMatches(a, b) {
    const aAmount = Number(a?.package_amount);
    const bAmount = Number(b?.package_amount);
    const aUnit = fold(a?.package_unit);
    const bUnit = fold(b?.package_unit);
    if (!(aAmount > 0) || !(bAmount > 0) || !aUnit || aUnit !== bUnit) return false;
    return Math.abs(aAmount - bAmount) <= Math.max(aAmount, bAmount) * .02;
  }

  function strongSameProduct(a, b) {
    if (!a?.product_id || String(a.product_id) !== String(b?.product_id)) return false;
    if (a.is_verified !== true || b.is_verified !== true) return false;
    if (String(a.catalog_match_status || '') !== 'matched' || String(b.catalog_match_status || '') !== 'matched') return false;
    const aTitle = fold(a.normalized_title || a.title);
    const bTitle = fold(b.normalized_title || b.title);
    const sameTitle = Boolean(aTitle && aTitle === bTitle && meaningfulTitle(aTitle));
    return sameTitle || packageMatches(a, b);
  }

  function preciseBranch(branches, position) {
    if (!branches?.length || !position) return null;
    const nearest = branches[0];
    const meters = Number(nearest.distance_km || Infinity) * 1000;
    const accuracy = Math.max(0, Number(position.accuracy || 0));
    if (!(accuracy > 0 && accuracy <= 45 && meters <= Math.max(55, accuracy * 1.35))) return null;
    return nearest;
  }

  async function safeOffers(branches) {
    const a = api();
    const storeIds = [...new Set((a.uniqueStores(branches) || []).map((branch) => String(branch.store_id)).filter(Boolean))].sort();
    const cacheKey = storeIds.join(',');
    const now = Date.now();
    if (safeCache && safeCache.key === cacheKey && now - safeCache.at < CACHE_MS) return safeCache.promise;
    const promise = a.rest('offers', {
      select: 'id,product_id,store_id,branch_id,title,normalized_title,price,old_price,package_amount,package_unit,valid_from,valid_to,coverage_scope,region_code,city_name,is_verified,catalog_match_status,stores(id,name,slug)',
      store_id: `in.(${storeIds.join(',')})`,
      status: 'eq.published',
      valid_from: `lte.${a.TODAY}`,
      valid_to: `gte.${a.TODAY}`,
      is_verified: 'eq.true',
      catalog_match_status: 'eq.matched',
      limit: '5000',
    }).then((rows) => (rows || []).filter((offer) => a.coverageMatches(offer, branches)));
    safeCache = { key: cacheKey, at: now, promise };
    return promise;
  }

  function nearestBranchForStore(branches, storeId) {
    return (branches || [])
      .filter((branch) => String(branch.store_id) === String(storeId))
      .sort((x, y) => Number(x.distance_km ?? Infinity) - Number(y.distance_km ?? Infinity))[0] || null;
  }

  function findComparisons(currentBranch, offers, branches) {
    const currentStoreId = String(currentBranch.store_id || '');
    const currentOffers = offers.filter((offer) => String(offer.store_id) === currentStoreId && Number(offer.price) > 0);
    const bestByProduct = new Map();

    for (const current of currentOffers) {
      const candidate = offers
        .filter((other) => String(other.store_id) !== currentStoreId
          && Number(other.price) > 0
          && Number(other.price) <= Number(current.price) * .98
          && strongSameProduct(current, other))
        .sort((x, y) => Number(x.price) - Number(y.price))[0];
      if (!candidate) continue;
      const saving = Number((Number(current.price) - Number(candidate.price)).toFixed(2));
      const row = { current, candidate, saving, branch: nearestBranchForStore(branches, candidate.store_id) };
      const key = String(current.product_id);
      const previous = bestByProduct.get(key);
      if (!previous || row.saving > previous.saving) bestByProduct.set(key, row);
    }

    return [...bestByProduct.values()].sort((a, b) => b.saving - a.saving);
  }

  function listSummary(comparisons) {
    const list = api().readList?.().filter((row) => !row.completed && row.product_id) || [];
    if (!list.length || !comparisons.length) return '';
    const byProduct = new Map(comparisons.map((row) => [String(row.current.product_id), row]));
    let count = 0;
    let saving = 0;
    for (const item of list) {
      const match = byProduct.get(String(item.product_id));
      if (!match) continue;
      count++;
      saving += match.saving * Math.max(.01, Number(item.quantity || 1));
    }
    if (!count) return '';
    return `<div class="slInStoreSafeList">V nákupním seznamu je <strong>${count}</strong> ${count === 1 ? 'ověřeně porovnatelná položka' : count < 5 ? 'ověřeně porovnatelné položky' : 'ověřeně porovnatelných položek'} levnější jinde; rozdíl je přibližně <strong>${money(saving)} Kč</strong>.</div>`;
  }

  async function waitForCard() {
    for (let i = 0; i < 40; i++) {
      const card = document.querySelector('#slInStore .slInStoreCard');
      if (card) return card;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return null;
  }

  async function renderSafeComparison() {
    const a = api();
    if (!a) return;
    try {
      const radius = Number(document.getElementById('slLiveRadius')?.value || 15);
      const position = await a.getPosition();
      const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
      const currentBranch = preciseBranch(branches, position);
      if (!currentBranch) return;
      const offers = await safeOffers(branches);
      const comparisons = findComparisons(currentBranch, offers, branches);
      const card = await waitForCard();
      if (!card) return;
      card.querySelector('.slInStoreSafe')?.remove();

      const safe = document.createElement('div');
      safe.className = 'slInStoreSafe';
      const rows = comparisons.slice(0, 3).map((row) => {
        const store = row.candidate.stores?.name || 'jiný řetězec';
        const distance = row.branch && Number.isFinite(Number(row.branch.distance_km))
          ? ` · ${Number(row.branch.distance_km).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km`
          : '';
        return `<div class="slInStoreSafeRow"><span><b>${esc(row.current.title || 'Produkt')}</b><small>${money(row.current.price)} Kč zde → ${money(row.candidate.price)} Kč v ${esc(store)}${esc(distance)}</small></span><strong>−${money(row.saving)} Kč<small>ověřený rozdíl</small></strong></div>`;
      }).join('');

      safe.innerHTML = comparisons.length
        ? `<div class="slInStoreSafeHead"><strong>Pozor: ověřeně levněji poblíž</strong><span>verified + catalog matched</span></div><div class="slInStoreSafeRows">${rows}</div>${listSummary(comparisons)}`
        : '<div class="slInStoreSafeHead"><strong>Porovnání stejného produktu mezi řetězci</strong><span>bez odhadu</span></div><p class="slInStoreSafeNote">Dnes tu nemáme dost <strong>ověřených katalogových shod stejného produktu nebo balení</strong> pro bezpečné tvrzení „jinde levněji“. TOP akce obchodu zobrazujeme dál, ale cenu napříč řetězci si nevymýšlíme.</p>';

      const grid = card.querySelector('.slInStoreGrid');
      if (grid) grid.before(safe); else card.querySelector('footer')?.before(safe);
    } catch {
      // Ověřené porovnání je doplněk; při chybě se základní in-store režim nemění.
    }
  }

  function bind() {
    const button = document.getElementById('slLiveLocate');
    if (!button || button.dataset.safeCompareBound === '1') return false;
    button.dataset.safeCompareBound = '1';
    button.addEventListener('click', () => { renderSafeComparison(); });
    return true;
  }

  function init() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const a = api();
      if (a?.__inStoreCacheReady && bind()) clearInterval(timer);
      else if (attempts >= 120) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
