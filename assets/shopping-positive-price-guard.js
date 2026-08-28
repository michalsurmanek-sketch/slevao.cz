(() => {
  'use strict';

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || db.__slevaoPositivePriceGuard) return;

  function hasPositivePrice(value) {
    const price = Number(value);
    return Number.isFinite(price) && price > 0;
  }

  function parseOffer(value) {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return null; }
  }

  function filterShoppingCandidates(data) {
    if (!Array.isArray(data)) return data;
    return data.filter((candidate) => hasPositivePrice(parseOffer(candidate?.offer)?.price));
  }

  const originalFrom = db.from.bind(db);
  const originalRpc = db.rpc.bind(db);

  db.from = function guardedFrom(table) {
    const query = originalFrom(table);
    if (table !== 'offers' || !query || typeof query.select !== 'function') return query;

    const originalSelect = query.select.bind(query);
    query.select = (...args) => {
      const selected = originalSelect(...args);
      const positive = selected && typeof selected.gt === 'function'
        ? selected.gt('price', 0)
        : selected;
      return positive && typeof positive.eq === 'function'
        ? positive.eq('is_verified', true)
        : positive;
    };
    return query;
  };

  db.rpc = function guardedRpc(name, args, options) {
    const request = originalRpc(name, args, options);
    if (name !== 'get_public_shopping_list_candidates') return request;
    return Promise.resolve(request).then((result) => ({
      ...result,
      data: filterShoppingCandidates(result?.data)
    }));
  };

  db.__slevaoPositivePriceGuard = true;
  window.SlevaoShoppingPositivePriceGuard = { hasPositivePrice, filterShoppingCandidates };
})();
