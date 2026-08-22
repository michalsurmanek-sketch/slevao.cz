(() => {
  'use strict';

  const HOME_FAVORITES_KEY = 'slevao-saved';
  const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';
  const RELOAD_KEY = 'slevao-favorite-offer-sync-v2';
  const SUPABASE_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const PERSONALIZATION_CSS_URL = 'assets/product-personalization.css?v=20260804-2';
  const PERSONALIZATION_JS_URL = 'assets/product-personalization.js?v=20260821-4';
  const HOME_PRODUCT_FAVORITES_URL = 'assets/home-product-favorites.js?v=20260822-1';
  let storageReloadPending = false;

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
    if (merged === null) return { merged:null, homeChanged:false, storeChanged:false };
    const normalized = JSON.stringify(merged);
    const homeChanged = homeRaw !== normalized;
    const storeChanged = storeRaw !== normalized;
    if (homeChanged) localStorage.setItem(HOME_FAVORITES_KEY, normalized);
    if (storeChanged) localStorage.setItem(STORE_FAVORITES_KEY, normalized);
    return { merged, homeChanged, storeChanged };
  }

  function scheduleHomepageReload() {
    if (!document.getElementById('savedButton') || storageReloadPending) return;
    storageReloadPending = true;
    window.setTimeout(() => location.reload(), 0);
  }

  function appendScript(src, marker, onload) {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) {
      if (onload) existing.addEventListener('load', onload, { once:true });
      return existing;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(marker, '1');
    if (onload) script.addEventListener('load', onload, { once:true });
    document.head.appendChild(script);
    return script;
  }

  function loadProductFavoriteRuntime() {
    if (typeof document === 'undefined' || !document.getElementById('dealGrid')) return;
    if (!document.querySelector('link[data-slevao-product-personalization]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PERSONALIZATION_CSS_URL;
      link.dataset.slevaoProductPersonalization = '1';
      document.head.appendChild(link);
    }

    const loadBridge = () => {
      if (window.SlevaoHomeProductFavorites) return;
      appendScript(HOME_PRODUCT_FAVORITES_URL, 'data-slevao-home-product-favorites');
    };
    const loadPersonalization = () => {
      if (window.SlevaoPersonalization) {
        loadBridge();
        return;
      }
      appendScript(PERSONALIZATION_JS_URL, 'data-slevao-product-personalization', loadBridge);
    };

    if (window.supabase?.createClient) {
      loadPersonalization();
      return;
    }
    const supabase = appendScript(SUPABASE_CLIENT_URL, 'data-slevao-supabase-client', loadPersonalization);
    supabase.addEventListener('error', () => console.warn('slevao_home_product_favorites_supabase_failed'), { once:true });
  }

  try {
    const initial = reconcileFavoriteKeys();

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
      if (event.newValue === null) {
        localStorage.removeItem(event.key);
      } else {
        const parsed = parseFavoriteList(event.newValue);
        if (parsed === null) return;
        localStorage.setItem(event.key, JSON.stringify(parsed));
      }
      scheduleHomepageReload();
    });

    if (initial.homeChanged && document.getElementById('savedButton')) {
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        location.reload();
        return;
      }
    }
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // Saved offers remain optional when browser Storage is unavailable.
  }

  window.SlevaoFavoriteOfferSync = { parseFavoriteList, mergeFavoriteLists, reconcileFavoriteKeys };
  loadProductFavoriteRuntime();
})();
