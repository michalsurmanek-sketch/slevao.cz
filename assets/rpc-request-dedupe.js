(() => {
  'use strict';

  if (typeof document !== 'undefined' && !document.querySelector('script[data-slevao-favorite-offer-sync]')) {
    const syncScript = document.createElement('script');
    syncScript.src = 'assets/home-favorite-offer-sync.js?v=20260822-2';
    syncScript.async = false;
    syncScript.dataset.slevaoFavoriteOfferSync = '1';
    document.head.appendChild(syncScript);
  }

  if (typeof document !== 'undefined' && !document.querySelector('script[data-slevao-count-semantics]')) {
    const countScript = document.createElement('script');
    countScript.src = 'assets/home-count-semantics.js?v=20260825-1';
    countScript.async = false;
    countScript.dataset.slevaoCountSemantics = '1';
    document.head.appendChild(countScript);
  }

  if (window.__slevaoFacetsFetchDedupe) return;

  const originalFetch = window.fetch.bind(window);
  const entries = new Map();
  const FACETS_RPC = '/rest/v1/rpc/get_public_offer_facets';
  const READ_RPC_PREFIX = '/rest/v1/rpc/get_public_';
  const GRACE_MS = 1000;
  const RETRY_DELAY_MS = 180;

  function cleanupExpired(now) {
    for (const [key, entry] of entries) {
      if (entry.settledAt && now - entry.settledAt > GRACE_MS) entries.delete(key);
    }
  }

  function fetchWithReadRetry(input, init, { url, method, isRequest }) {
    const isSafeReadRpc = !isRequest && method === 'POST' && url.includes(READ_RPC_PREFIX);
    if (!isSafeReadRpc) return originalFetch(input, init);

    const signal = init?.signal;
    return originalFetch(input, init).catch(async (error) => {
      if (!(error instanceof TypeError) || signal?.aborted) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      if (signal?.aborted) throw error;
      return originalFetch(input, init);
    });
  }

  window.fetch = function slevaoFetch(input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = typeof input === 'string' ? input : (isRequest ? input.url : '');
    const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';
    const requestMeta = { url, method, isRequest };

    if (!url.includes(FACETS_RPC) || method !== 'POST' || !body) {
      return fetchWithReadRetry(input, init, requestMeta);
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
    entry.promise = fetchWithReadRetry(input, init, requestMeta).then(
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