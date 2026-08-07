(() => {
  'use strict';

  const CACHE_MS = 30000;
  let linkCache = null;

  async function waitForLocationApi(timeout = 6000) {
    const started = Date.now();
    while (!window.SlevaoLocation && Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return window.SlevaoLocation || null;
  }

  async function activeLinks(api) {
    const now = Date.now();
    if (linkCache && now - linkCache.at < CACHE_MS) return linkCache.promise;
    const promise = api.rest('product_equivalences', {
      select: 'product_id_a,product_id_b,confidence',
      is_active: 'eq.true',
      confidence: 'gte.0.99',
      limit: '1000',
    });
    linkCache = { at: now, promise };
    return promise;
  }

  function counterpartMap(links, requestedIds) {
    const requested = new Set(requestedIds.map(String));
    const map = new Map();
    const add = (source, target) => {
      if (!requested.has(String(target))) return;
      const rows = map.get(String(source)) || new Set();
      rows.add(String(target));
      map.set(String(source), rows);
    };
    for (const link of links || []) {
      add(link.product_id_a, link.product_id_b);
      add(link.product_id_b, link.product_id_a);
    }
    return map;
  }

  const offerSelect = 'id,product_id,store_id,branch_id,title,image_url,price,old_price,discount_percent,valid_from,valid_to,coverage_scope,region_code,city_name,is_verified,confidence_score,stores(id,name,slug,logo_url,primary_color)';

  async function fetchEquivalentOffers(api, counterpartIds, storeIds, branches) {
    const products = [...new Set(counterpartIds.filter(Boolean).map(String))];
    const stores = [...new Set(storeIds.filter(Boolean).map(String))];
    if (!products.length || !stores.length) return [];
    const output = [];
    for (let index = 0; index < products.length; index += 35) {
      const chunk = products.slice(index, index + 35);
      const rows = await api.rest('offers', {
        select: offerSelect,
        product_id: `in.(${chunk.join(',')})`,
        store_id: `in.(${stores.join(',')})`,
        status: 'eq.published',
        valid_from: `lte.${api.TODAY}`,
        valid_to: `gte.${api.TODAY}`,
        limit: '5000',
      });
      output.push(...(rows || []));
    }
    return output.filter((offer) => api.coverageMatches(offer, branches));
  }

  async function install() {
    const api = await waitForLocationApi();
    if (!api || api.__equivalenceBasketReady) return;
    api.__equivalenceBasketReady = true;

    const original = api.fetchOffersForList.bind(api);
    api.fetchOffersForList = async (rows, storeIds, branches = []) => {
      const activeRows = (rows || []).filter((row) => !row.completed && row.product_id);
      const requestedIds = [...new Set(activeRows.map((row) => String(row.product_id)))];
      const exact = await original(rows, storeIds, branches);
      if (!requestedIds.length) return exact;

      const links = await activeLinks(api);
      const map = counterpartMap(links, requestedIds);
      if (!map.size) return exact;

      const counterpartIds = [...map.keys()].filter((id) => !requestedIds.includes(id));
      const equivalents = await fetchEquivalentOffers(api, counterpartIds, storeIds || [], branches);
      if (!equivalents.length) return exact;

      const cloned = [];
      for (const offer of equivalents) {
        const targets = map.get(String(offer.product_id));
        if (!targets?.size) continue;
        for (const targetId of targets) {
          cloned.push({
            ...offer,
            source_product_id: offer.product_id,
            product_id: targetId,
            equivalence_product_id: offer.product_id,
            equivalence_match: true,
          });
        }
      }

      const seen = new Set();
      return [...exact, ...cloned].filter((offer) => {
        const key = `${offer.id}:${offer.product_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
  }

  install().catch((error) => console.warn('SLEVAO location equivalence:', error?.message || error));
})();
