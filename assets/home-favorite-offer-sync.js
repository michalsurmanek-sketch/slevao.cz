(() => {
  'use strict';

  const HOME_FAVORITES_KEY = 'slevao-saved';
  const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';
  let reloadPending = false;

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

      function nativeGetItem(key) {
        return Storage.prototype.getItem.call(window.localStorage, key);
      }
    }

    window.addEventListener('storage', (event) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== HOME_FAVORITES_KEY && event.key !== STORE_FAVORITES_KEY) return;
      reconcileFavoriteKeys();
      if (reloadPending) return;
      reloadPending = true;
      window.setTimeout(() => location.reload(), 0);
    });
  } catch {
    // Storage can be disabled. Homepage must continue without saved-offer sync.
  }

  window.SlevaoFavoriteOfferSync = { parseFavoriteList, mergeFavoriteLists, reconcileFavoriteKeys };
})();
