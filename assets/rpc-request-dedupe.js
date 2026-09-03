(() => {
  'use strict';

  function markHeroMetricsPending() {
    if (typeof document === 'undefined') return;
    for (const id of ['offerCount', 'storeCount']) {
      const value = document.getElementById(id);
      if (value && value.textContent.trim() === '0') value.textContent = '…';
    }
  }

  markHeroMetricsPending();

  if (typeof document !== 'undefined' && !document.querySelector('script[data-slevao-favorite-offer-sync]')) {
    const syncScript = document.createElement('script');
    syncScript.src = 'assets/home-favorite-offer-sync.js?v=20260827-1';
    syncScript.async = false;
    syncScript.dataset.slevaoFavoriteOfferSync = '1';
    document.head.appendChild(syncScript);
  }

  if (typeof document !== 'undefined' && !document.querySelector('script[data-slevao-count-semantics]')) {
    const countScript = document.createElement('script');
    countScript.src = 'assets/home-count-semantics.js?v=20260901-1';
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
  const RETRY_DELAYS_MS = [350, 1100, 2400];
  const ALLOWED_MODES = new Set(['all','recommended','food','ending','under50','under100','discount','new']);
  let facetModeHint = new URLSearchParams(location.search).get('q')?.trim() ? 'all' : 'recommended';
  let facetContextEngaged = false;
  let globalFacetsPassed = false;

  function setFacetModeHint(mode) {
    facetContextEngaged = true;
    if (ALLOWED_MODES.has(mode)) facetModeHint = mode;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
      if (!event.isTrusted) return;

      const quick = event.target.closest('#quickTabs [data-mode]');
      if (quick?.dataset.mode && ALLOWED_MODES.has(quick.dataset.mode)) {
        setFacetModeHint(quick.dataset.mode);
        return;
      }

      if (event.target.closest('#resetFilters,[data-clear="all"]')) {
        setFacetModeHint('recommended');
        return;
      }
      if (event.target.closest('[data-clear="query"]')) {
        setFacetModeHint(facetModeHint === 'all' ? 'recommended' : facetModeHint);
        return;
      }

      if (event.target.closest('#searchButton')) {
        setFacetModeHint(document.getElementById('q')?.value.trim() ? 'all' : 'recommended');
        return;
      }

      const category = event.target.closest('#categoryChips [data-category]');
      if (category) {
        setFacetModeHint(facetModeHint === 'food' && category.dataset.category !== 'food' ? 'all' : facetModeHint);
        return;
      }
      if (event.target.closest('#clearCategory')) {
        setFacetModeHint(facetModeHint === 'food' ? 'all' : facetModeHint);
      }
    }, true);

    document.addEventListener('input', (event) => {
      if (!event.isTrusted) return;
      if (event.target?.id === 'sideSearch') setFacetModeHint(event.target.value.trim() ? 'all' : 'recommended');
    }, true);

    document.addEventListener('keydown', (event) => {
      if (!event.isTrusted) return;
      if (event.target?.id === 'q' && event.key === 'Enter') setFacetModeHint(event.target.value.trim() ? 'all' : 'recommended');
    }, true);

    document.addEventListener('change', (event) => {
      if (!event.isTrusted) return;
      if (event.target?.id === 'categorySelect') {
        setFacetModeHint(facetModeHint === 'food' && event.target.value !== 'food' ? 'all' : facetModeHint);
      }
    }, true);
  }

  function cleanupExpired(now) {
    for (const [key, entry] of entries) {
      if (entry.settledAt && now - entry.settledAt > GRACE_MS) entries.delete(key);
    }
  }

  function fetchWithReadRetry(input, init, { url, method, isRequest }) {
    return (async () => {
      const isSafeReadRpc = !isRequest && method === 'POST' && url.includes(READ_RPC_PREFIX);
      if (!isSafeReadRpc) return originalFetch(input, init);

      const signal = init?.signal;
      let lastError = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        if (signal?.aborted) throw lastError || new DOMException('Aborted', 'AbortError');
        try {
          return await originalFetch(input, init);
        } catch (error) {
          lastError = error;
          const retryableNetworkError = error instanceof TypeError;
          if (!retryableNetworkError || signal?.aborted || attempt === RETRY_DELAYS_MS.length) throw error;
          const RETRY_DELAY_MS = RETRY_DELAYS_MS[attempt];
          await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
      throw lastError || new TypeError('Failed to fetch');
    })();
  }

  function contextualFacetBody(body) {
    let payload;
    try { payload = JSON.parse(body); } catch { return body; }
    if (!payload || payload.p_mode !== 'all') return body;
    if (String(payload.p_query || '').trim()) return body;

    const isGlobalShape = payload.p_store_slug == null
      && payload.p_min_price == null
      && payload.p_max_price == null
      && payload.p_only_images === false
      && payload.p_filter_group == null
      && payload.p_region_code == null
      && payload.p_city_name == null;

    if (!globalFacetsPassed && isGlobalShape) {
      globalFacetsPassed = true;
      return body;
    }

    // The clean homepage startup intentionally reuses the global facets promise.
    // Synthetic initialization events must not turn its duplicate into a new mode request.
    if (!facetContextEngaged) return body;

    if (!ALLOWED_MODES.has(facetModeHint) || facetModeHint === 'all') return body;
    payload.p_mode = facetModeHint;
    return JSON.stringify(payload);
  }

  window.fetch = function slevaoFetch(input, init) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = typeof input === 'string' ? input : (isRequest ? input.url : '');
    const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase();
    let body = typeof init?.body === 'string' ? init.body : '';
    let effectiveInit = init;

    if (url.includes(FACETS_RPC) && method === 'POST' && body) {
      const rewrittenBody = contextualFacetBody(body);
      if (rewrittenBody !== body) {
        body = rewrittenBody;
        effectiveInit = { ...(init || {}), body };
      }
    }

    const requestMeta = { url, method, isRequest };

    if (!url.includes(FACETS_RPC) || method !== 'POST' || !body) {
      return fetchWithReadRetry(input, effectiveInit, requestMeta);
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
    entry.promise = fetchWithReadRetry(input, effectiveInit, requestMeta).then(
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
  window.__slevaoFacetModeFix = true;
})();