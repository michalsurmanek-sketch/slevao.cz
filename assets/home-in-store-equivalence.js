(() => {
  'use strict';

  const CACHE_MS = 30000;
  let cache = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const api = () => window.SlevaoLocation || null;

  function productOf(offer) {
    return Array.isArray(offer?.products) ? offer.products[0] : offer?.products;
  }

  function quantity(value) {
    const text = fold(value);
    const multi = text.match(/\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/i);
    const single = multi || text.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/i);
    if (!single) return null;
    let amount;
    let unit;
    if (multi) {
      amount = Number(multi[1]) * Number(String(multi[2]).replace(',', '.'));
      unit = multi[3].toLowerCase();
    } else {
      amount = Number(String(single[1]).replace(',', '.'));
      unit = single[2].toLowerCase();
    }
    if (!(amount > 0)) return null;
    if (unit === 'kg') return { family:'mass', amount:amount * 1000 };
    if (unit === 'g') return { family:'mass', amount };
    if (unit === 'mg') return { family:'mass', amount:amount / 1000 };
    if (unit === 'l') return { family:'volume', amount:amount * 1000 };
    if (unit === 'cl') return { family:'volume', amount:amount * 10 };
    if (unit === 'ml') return { family:'volume', amount };
    if (unit === 'ks') return { family:'count', amount };
    return null;
  }

  function sameQuantity(a, b) {
    if (!a || !b || a.family !== b.family) return false;
    return Math.abs(a.amount - b.amount) <= Math.max(a.amount, b.amount) * .02;
  }

  function runtimeIdentityConsistent(a, b) {
    const left = productOf(a);
    const right = productOf(b);
    const leftBrand = fold(left?.brand);
    const rightBrand = fold(right?.brand);
    if (!leftBrand || leftBrand !== rightBrand) return false;
    const leftQty = quantity(left?.quantity_text || left?.name || a?.title);
    const rightQty = quantity(right?.quantity_text || right?.name || b?.title);
    return sameQuantity(leftQty, rightQty);
  }

  function preciseBranch(branches, position) {
    if (!branches?.length || !position) return null;
    const nearest = branches[0];
    const meters = Number(nearest.distance_km || Infinity) * 1000;
    const accuracy = Math.max(0, Number(position.accuracy || 0));
    if (!(accuracy > 0 && accuracy <= 45 && meters <= Math.max(55, accuracy * 1.35))) return null;
    return nearest;
  }

  function pairKey(a, b) {
    return [String(a || ''), String(b || '')].sort().join('|');
  }

  async function fetchEquivalences(productIds) {
    const a = api();
    const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
    const rows = [];
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50);
      const list = chunk.join(',');
      const batch = await a.rest('product_equivalences', {
        select: 'product_id_a,product_id_b,match_method,confidence',
        is_active: 'eq.true',
        confidence: 'gte.0.99',
        or: `(product_id_a.in.(${list}),product_id_b.in.(${list}))`,
        limit: '1000',
      });
      rows.push(...(batch || []));
    }
    const unique = new Map();
    for (const row of rows) unique.set(pairKey(row.product_id_a, row.product_id_b), row);
    return [...unique.values()];
  }

  const offerSelect = 'id,product_id,store_id,title,price,old_price,valid_from,valid_to,coverage_scope,region_code,city_name,is_verified,catalog_match_status,stores(id,name,slug),products(id,name,brand,quantity_text)';

  async function currentStoreOffers(branch, branches) {
    const a = api();
    const rows = await a.rest('offers', {
      select: offerSelect,
      store_id: `eq.${branch.store_id}`,
      status: 'eq.published',
      valid_from: `lte.${a.TODAY}`,
      valid_to: `gte.${a.TODAY}`,
      is_verified: 'eq.true',
      catalog_match_status: 'in.(matched,retained)',
      limit: '2000',
    });
    return (rows || []).filter((offer) => a.coverageMatches(offer, branches));
  }

  async function counterpartOffers(productIds, storeIds, branches) {
    const a = api();
    const products = [...new Set((productIds || []).filter(Boolean).map(String))];
    const stores = [...new Set((storeIds || []).filter(Boolean).map(String))];
    if (!products.length || !stores.length) return [];
    const rows = [];
    for (let index = 0; index < products.length; index += 40) {
      const chunk = products.slice(index, index + 40);
      const batch = await a.rest('offers', {
        select: offerSelect,
        product_id: `in.(${chunk.join(',')})`,
        store_id: `in.(${stores.join(',')})`,
        status: 'eq.published',
        valid_from: `lte.${a.TODAY}`,
        valid_to: `gte.${a.TODAY}`,
        is_verified: 'eq.true',
        catalog_match_status: 'in.(matched,retained)',
        limit: '5000',
      });
      rows.push(...(batch || []));
    }
    return rows.filter((offer) => a.coverageMatches(offer, branches));
  }

  function nearestBranchForStore(branches, storeId) {
    return (branches || [])
      .filter((branch) => String(branch.store_id) === String(storeId))
      .sort((x, y) => Number(x.distance_km ?? Infinity) - Number(y.distance_km ?? Infinity))[0] || null;
  }

  function findComparisons(current, alternatives, links, branches) {
    const linkMap = new Map();
    for (const link of links) linkMap.set(pairKey(link.product_id_a, link.product_id_b), link);
    const results = [];
    for (const offer of current) {
      const cheaper = alternatives
        .filter((candidate) => Number(candidate.price) > 0
          && Number(candidate.price) <= Number(offer.price) * .98
          && linkMap.has(pairKey(offer.product_id, candidate.product_id))
          && runtimeIdentityConsistent(offer, candidate))
        .sort((a, b) => Number(a.price) - Number(b.price))[0];
      if (!cheaper) continue;
      const link = linkMap.get(pairKey(offer.product_id, cheaper.product_id));
      results.push({
        current: offer,
        candidate: cheaper,
        saving: Number((Number(offer.price) - Number(cheaper.price)).toFixed(2)),
        branch: nearestBranchForStore(branches, cheaper.store_id),
        method: link?.match_method || 'manual_review',
      });
    }
    return results.sort((a, b) => b.saving - a.saving);
  }

  async function waitForCard() {
    for (let index = 0; index < 50; index++) {
      const card = document.querySelector('#slInStore .slInStoreCard');
      if (card) return card;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return null;
  }

  function render(comparisons) {
    if (!comparisons.length) return;
    return waitForCard().then((card) => {
      if (!card) return;
      const existing = card.querySelector('.slInStoreSafe');
      const block = existing || document.createElement('div');
      block.className = 'slInStoreSafe';
      const rows = comparisons.slice(0, 3).map((row) => {
        const store = row.candidate.stores?.name || 'jiný řetězec';
        const distance = row.branch && Number.isFinite(Number(row.branch.distance_km))
          ? ` · ${Number(row.branch.distance_km).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km`
          : '';
        return `<div class="slInStoreSafeRow"><span><b>${esc(row.current.title || 'Produkt')}</b><small>${money(row.current.price)} Kč zde → ${money(row.candidate.price)} Kč v ${esc(store)}${esc(distance)}</small></span><strong>−${money(row.saving)} Kč<small>potvrzená equivalence</small></strong></div>`;
      }).join('');
      block.innerHTML = `<div class="slInStoreSafeHead"><strong>Pozor: stejný výrobek je ověřeně levněji poblíž</strong><span>evidence identity ≥ 99 %</span></div><div class="slInStoreSafeRows">${rows}</div>`;
      if (!existing) {
        const grid = card.querySelector('.slInStoreGrid');
        if (grid) grid.before(block); else card.querySelector('footer')?.before(block);
      }
    });
  }

  async function evaluate() {
    const a = api();
    if (!a) return;
    try {
      const radius = Number(document.getElementById('slLiveRadius')?.value || 15);
      const position = await a.getPosition();
      const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
      const branch = preciseBranch(branches, position);
      if (!branch) return;

      const key = `${branch.id}:${radius}`;
      const now = Date.now();
      if (cache && cache.key === key && now - cache.at < CACHE_MS) {
        await render(await cache.promise);
        return;
      }

      const promise = (async () => {
        const current = await currentStoreOffers(branch, branches);
        const links = await fetchEquivalences(current.map((offer) => offer.product_id));
        if (!links.length) return [];
        const currentIds = new Set(current.map((offer) => String(offer.product_id)));
        const counterpartIds = [];
        for (const link of links) {
          if (currentIds.has(String(link.product_id_a))) counterpartIds.push(link.product_id_b);
          if (currentIds.has(String(link.product_id_b))) counterpartIds.push(link.product_id_a);
        }
        const nearbyStores = a.uniqueStores(branches)
          .map((row) => String(row.store_id))
          .filter((id) => id !== String(branch.store_id));
        const alternatives = await counterpartOffers(counterpartIds, nearbyStores, branches);
        return findComparisons(current, alternatives, links, branches);
      })();
      cache = { key, at: now, promise };
      await render(await promise);
    } catch {
      // Equivalence comparison is optional; the base in-store experience remains intact.
    }
  }

  function bind() {
    const button = document.getElementById('slLiveLocate');
    if (!button || button.dataset.equivalenceBound === '1') return false;
    button.dataset.equivalenceBound = '1';
    button.addEventListener('click', () => { evaluate(); });
    return true;
  }

  function init() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (api()?.__inStoreCacheReady && bind()) clearInterval(timer);
      else if (attempts >= 120) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
