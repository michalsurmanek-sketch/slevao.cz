(() => {
  'use strict';

  if (typeof document !== 'undefined' && !document.querySelector('script[data-slevao-favorite-offer-sync]')) {
    const syncScript = document.createElement('script');
    syncScript.src = 'assets/home-favorite-offer-sync.js?v=20260822-2';
    syncScript.async = false;
    syncScript.dataset.slevaoFavoriteOfferSync = '1';
    document.head.appendChild(syncScript);
  }

  if (window.__slevaoFacetsFetchDedupe) return;

  const originalFetch = window.fetch.bind(window);
  const entries = new Map();
  const FACETS_RPC = '/rest/v1/rpc/get_public_offer_facets';
  const GRACE_MS = 1000;

  function cleanupExpired(now) {
    for (const [key, entry] of entries) {
      if (entry.settledAt && now - entry.settledAt > GRACE_MS) entries.delete(key);
    }
  }

  window.fetch = function slevaoFetch(input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = typeof input === 'string' ? input : (isRequest ? input.url : '');
    const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';

    if (!url.includes(FACETS_RPC) || method !== 'POST' || !body) {
      return originalFetch(input, init);
    }

    const now = Date.now();
    cleanupExpired(now);
    const key = `${url}\n${body}`;
    const existing = entries.get(key);
    if (existing && (!existing.settledAt || now - existing.settledAt <= GRACE_MS)) {
      return existing.promise.then((response) => response.clone());
    }
    if (existing) entries.delete(key);

    const entry = { settledAt: 0, promise: null };
    entry.promise = originalFetch(input, init).then(
      (response) => {
        entry.settledAt = Date.now();
        return response.clone();
      },
      (error) => {
        entries.delete(key);
        throw error;
      }
    );

    entries.set(key, entry);
    return entry.promise.then((response) => response.clone());
  };

  window.__slevaoFacetsFetchDedupe = true;
})();
