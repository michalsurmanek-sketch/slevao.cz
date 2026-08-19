(() => {
  'use strict';

  if (window.__slevaoFacetsFetchDedupe) return;

  const originalFetch = window.fetch.bind(window);
  const inflight = new Map();
  const FACETS_RPC = '/rest/v1/rpc/get_public_offer_facets';

  window.fetch = function slevaoFetch(input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = typeof input === 'string' ? input : (isRequest ? input.url : '');
    const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';

    if (!url.includes(FACETS_RPC) || method !== 'POST' || !body) {
      return originalFetch(input, init);
    }

    const key = `${url}\n${body}`;
    const existing = inflight.get(key);
    if (existing) return existing.then((response) => response.clone());

    const shared = originalFetch(input, init)
      .then((response) => response.clone())
      .finally(() => inflight.delete(key));

    inflight.set(key, shared);
    return shared.then((response) => response.clone());
  };

  window.__slevaoFacetsFetchDedupe = true;
})();
