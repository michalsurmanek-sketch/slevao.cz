(() => {
  'use strict';

  const api = window.SlevaoLocation;
  if (!api || api.__slevaoRoutePositivePriceGuard) return;

  function positiveOffers(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter((offer) => {
      const price = Number(offer?.price);
      return Number.isFinite(price) && price > 0;
    });
  }

  for (const method of ['fetchOffersForList', 'fetchOffersForStores']) {
    const original = api[method];
    if (typeof original !== 'function') continue;
    api[method] = async (...args) => positiveOffers(await original(...args));
  }

  api.__slevaoRoutePositivePriceGuard = true;
  window.SlevaoShoppingRoutePositivePriceGuard = { positiveOffers };
})();
