(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';
  const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';
  const INSIGHTS_URL = 'assets/shopping-insights.js?v=20260821-1';
  const db = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  let bootedUserId = null;
  let insightLoaded = false;

  function installBudgetOwnerBridge() {
    if (Storage.prototype.__slevaoShoppingBudgetOwnerBridge) return;

    const nativeGetItem = Storage.prototype.getItem;
    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    const activeUserId = () => String(nativeGetItem.call(window.localStorage, ACTIVE_USER_KEY) || '').trim();
    const activeOwner = () => activeUserId() ? `user:${activeUserId()}` : 'guest';
    const storageKey = () => `${BUDGET_KEY_PREFIX}${activeOwner()}`;

    Object.defineProperty(Storage.prototype, '__slevaoShoppingBudgetOwnerBridge', {
      value: true,
      configurable: true
    });

    Storage.prototype.getItem = function getItem(key) {
      if (this === window.localStorage && key === LEGACY_BUDGET_KEY) {
        return nativeGetItem.call(this, storageKey());
      }
      return nativeGetItem.call(this, key);
    };

    Storage.prototype.setItem = function setItem(key, value) {
      if (this === window.localStorage && key === LEGACY_BUDGET_KEY) {
        return nativeSetItem.call(this, storageKey(), String(value));
      }
      return nativeSetItem.call(this, key, String(value));
    };

    Storage.prototype.removeItem = function removeItem(key) {
      if (this === window.localStorage && key === LEGACY_BUDGET_KEY) {
        return nativeRemoveItem.call(this, storageKey());
      }
      return nativeRemoveItem.call(this, key);
    };

    window.SlevaoShoppingBudgetStorage = { activeOwner, storageKey };
  }

  function markerUserId() {
    try { return String(localStorage.getItem(ACTIVE_USER_KEY) || '').trim(); }
    catch { return ''; }
  }

  function setMarkerUserId(userId) {
    const normalized = String(userId || '').trim();
    try {
      if (normalized) localStorage.setItem(ACTIVE_USER_KEY, normalized);
      else localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {}
  }

  function loadInsights() {
    if (insightLoaded || document.querySelector('script[src*="shopping-insights.js"]')) return;
    insightLoaded = true;
    const script = document.createElement('script');
    script.src = INSIGHTS_URL;
    script.async = false;
    document.head.appendChild(script);
  }

  async function boot() {
    installBudgetOwnerBridge();
    if (!db) {
      loadInsights();
      return;
    }

    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const currentUserId = String(data?.session?.user?.id || '');
    const previousMarker = markerUserId();
    setMarkerUserId(currentUserId);
    bootedUserId = currentUserId;

    // shopping-list.js runs before this bootstrap. If the persisted owner marker
    // was stale, reload once so every shopping consumer starts under the same owner.
    if (previousMarker !== currentUserId) {
      location.reload();
      return;
    }
    loadInsights();
  }

  let authSubscription = null;
  if (db?.auth?.onAuthStateChange) {
    const result = db.auth.onAuthStateChange((event, nextSession) => {
      if (!['SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;
      const nextUserId = event === 'SIGNED_OUT' ? '' : String(nextSession?.user?.id || '');
      if (bootedUserId === null || nextUserId === bootedUserId) return;
      setMarkerUserId(nextUserId);
      bootedUserId = nextUserId;
      window.setTimeout(() => location.reload(), 0);
    });
    authSubscription = result?.data?.subscription || null;
  }

  window.addEventListener('pagehide', () => authSubscription?.unsubscribe?.(), { once:true });

  boot().catch((error) => {
    console.warn('slevao_shopping_insights_boot_failed', error);
  });
})();
