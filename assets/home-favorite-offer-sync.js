(() => {
  'use strict';

  const HOME_FAVORITES_KEY = 'slevao-saved';
  const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';
  const RELOAD_KEY = 'slevao-favorite-offer-sync-v2';
  const SUPABASE_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4';
  const SHARED_SUPABASE_CLIENT_URL = 'assets/supabase-client.js?v=20260825-1';
  const PERSONALIZATION_CSS_URL = 'assets/product-personalization.css?v=20260816-4';
  const PERSONALIZATION_JS_URL = 'assets/product-personalization.js?v=20260827-3';
  const HOME_PRODUCT_FAVORITES_URL = 'assets/home-product-favorites.js?v=20260822-1';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let storageReloadPending = false;
  let liveReconcilePending = false;

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

  async function reconcileLiveFavoriteOffers() {
    if (liveReconcilePending) return;
    const stored = parseFavoriteList(localStorage.getItem(HOME_FAVORITES_KEY)) || [];
    if (!stored.length) return;

    const validIds = stored.filter((id) => UUID_RE.test(id));
    const applyCleaned = (cleaned) => {
      const changed = cleaned.length !== stored.length || cleaned.some((id, index) => id !== stored[index]);
      if (!changed) return false;
      localStorage.setItem(HOME_FAVORITES_KEY, JSON.stringify(cleaned));
      const badge = document.getElementById('savedCount');
      if (badge) badge.textContent = String(cleaned.length);
      scheduleHomepageReload();
      return true;
    };

    if (!validIds.length) {
      applyCleaned([]);
      return;
    }

    liveReconcilePending = true;
    try {
      const client = await Promise.resolve(window.SlevaoSupabase?.getClient?.());
      if (!client?.rpc) return;

      const liveIds = new Set();
      for (let offset = 0; offset < validIds.length; offset += 100) {
        const chunk = validIds.slice(offset, offset + 100);
        const { data, error } = await client.rpc('get_public_saved_offer_page', {
          p_offer_ids: chunk,
          p_limit: 100,
          p_offset: 0,
          p_store_slug: null,
          p_min_price: null,
          p_max_price: null,
          p_only_images: false,
          p_query: null,
          p_filter_group: null,
          p_region_code: null,
          p_city_name: null,
          p_sort: 'recommended',
        });
        if (error) throw error;
        for (const row of Array.isArray(data) ? data : []) {
          const id = String(row?.offer?.id || '').trim();
          if (id) liveIds.add(id);
        }
      }

      applyCleaned(validIds.filter((id) => liveIds.has(id)));
    } catch (error) {
      console.warn('slevao_live_favorite_reconcile_failed', error);
    } finally {
      liveReconcilePending = false;
    }
  }

  function appendScript(src, marker, onload) {
    const assetPath = src.split('?')[0];
    const existing = document.querySelector(`script[${marker}],script[src*="${assetPath}"]`);
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
    if (!document.querySelector('link[href*="product-personalization.css"]')) {
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
    const reconcileAndLoadPersonalization = () => {
      reconcileLiveFavoriteOffers();
      loadPersonalization();
    };

    const loadSharedClient = () => {
      if (window.SlevaoSupabase?.getClient) {
        reconcileAndLoadPersonalization();
        return;
      }
      const shared = appendScript(
        SHARED_SUPABASE_CLIENT_URL,
        'data-slevao-shared-supabase-client',
        reconcileAndLoadPersonalization,
      );
      shared.addEventListener('error', () => console.warn('slevao_home_shared_supabase_failed'), { once:true });
    };

    if (window.supabase?.createClient) {
      loadSharedClient();
      return;
    }
    const supabase = appendScript(SUPABASE_CLIENT_URL, 'data-slevao-supabase-client', loadSharedClient);
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

  window.SlevaoFavoriteOfferSync = {
    parseFavoriteList,
    mergeFavoriteLists,
    reconcileFavoriteKeys,
    reconcileLiveFavoriteOffers,
  };
  loadProductFavoriteRuntime();
})();
