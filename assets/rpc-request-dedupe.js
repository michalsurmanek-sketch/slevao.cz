(() => {
  'use strict';

  const HOME_FAVORITES_KEY = 'slevao-saved';
  const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';
  let favoriteStorageReloadPending = false;

  function parseFavoriteList(raw) {
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? [...new Set(value.map(String))] : null;
    } catch {
      return null;
    }
  }

  function mergeFavoriteLists(...lists) {
    const available = lists.filter(Array.isArray);
    return available.length ? [...new Set(available.flat().map(String))] : null;
  }

  function reconcileFavoriteKeys() {
    const homeRaw = localStorage.getItem(HOME_FAVORITES_KEY);
    const storeRaw = localStorage.getItem(STORE_FAVORITES_KEY);
    const merged = mergeFavoriteLists(parseFavoriteList(homeRaw), parseFavoriteList(storeRaw));
    if (merged === null) return null;
    const normalized = JSON.stringify(merged);
    if (homeRaw !== normalized) localStorage.setItem(HOME_FAVORITES_KEY, normalized);
    if (storeRaw !== normalized) localStorage.setItem(STORE_FAVORITES_KEY, normalized);
    return merged;
  }

  try {
    reconcileFavoriteKeys();

    if (!Storage.prototype.__slevaoFavoriteSyncPatched) {
      const nativeGetItem = Storage.prototype.getItem;
      const nativeSetItem = Storage.prototype.setItem;
      const nativeRemoveItem = Storage.prototype.removeItem;
      Object.defineProperty(Storage.prototype, '__slevaoFavoriteSyncPatched', {
        value: true,
        configurable: true,
      });
      Storage.prototype.setItem = function setItem(key, value) {
        nativeSetItem.call(this, key, value);
        if (this !== window.localStorage) return;
        if (key !== HOME_FAVORITES_KEY && key !== STORE_FAVORITES_KEY) return;
        const parsed = parseFavoriteList(String(value));
        if (parsed === null) return;
        const normalized = JSON.stringify(parsed);
        if (String(value) !== normalized) nativeSetItem.call(this, key, normalized);
        const mirrorKey = key === HOME_FAVORITES_KEY ? STORE_FAVORITES_KEY : HOME_FAVORITES_KEY;
        if (nativeGetItem.call(this, mirrorKey) !== normalized) nativeSetItem.call(this, mirrorKey, normalized);
      };
      Storage.prototype.removeItem = function removeItem(key) {
        nativeRemoveItem.call(this, key);
        if (this !== window.localStorage) return;
        if (key !== HOME_FAVORITES_KEY && key !== STORE_FAVORITES_KEY) return;
        const mirrorKey = key === HOME_FAVORITES_KEY ? STORE_FAVORITES_KEY : HOME_FAVORITES_KEY;
        nativeRemoveItem.call(this, mirrorKey);
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== HOME_FAVORITES_KEY && event.key !== STORE_FAVORITES_KEY) return;
      reconcileFavoriteKeys();
      if (favoriteStorageReloadPending) return;
      favoriteStorageReloadPending = true;
      window.setTimeout(() => location.reload(), 0);
    });
  } catch {
    // Saved offers remain optional when Storage is unavailable.
  }

  window.SlevaoFavoriteOfferSync = { parseFavoriteList, mergeFavoriteLists, reconcileFavoriteKeys };

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
