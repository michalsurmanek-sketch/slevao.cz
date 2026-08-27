(() => {
  'use strict';

  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';
  const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';
  const LIST_URL = 'assets/shopping-list.js?v=20260827-1';
  const INSIGHTS_URL = 'assets/shopping-insights.js?v=20260821-1';
  const sharedParams = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedParams.get('share') || sharedHash.get('share'));
  const db = window.SlevaoSupabase?.getClient?.();
  let bootedUserId = null;
  let listLoaded = false;
  let insightLoaded = false;
  let reloadQueued = false;

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
    window.SlevaoPublic?.updateNavCount?.();
  }

  function loadList() {
    if (listLoaded || document.querySelector('script[src*="shopping-list.js"]')) return;
    listLoaded = true;
    const script = document.createElement('script');
    script.src = LIST_URL;
    script.async = false;
    document.head.appendChild(script);
  }

  function loadInsights() {
    if (insightLoaded || document.querySelector('script[src*="shopping-insights.js"]')) return;
    insightLoaded = true;
    const script = document.createElement('script');
    script.src = INSIGHTS_URL;
    script.async = false;
    document.head.appendChild(script);
  }

  function loadShoppingRuntimes() {
    loadList();
    loadInsights();
  }

  function handleIdentityChange(nextUserId) {
    setMarkerUserId(nextUserId || null);
    if (sharedMode || reloadQueued) return;
    reloadQueued = true;
    window.setTimeout(() => location.reload(), 0);
  }

  async function boot() {
    installBudgetOwnerBridge();
    if (!db) {
      loadShoppingRuntimes();
      return;
    }

    let currentUserId = '';
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      currentUserId = String(data?.session?.user?.id || '');
    } catch {
      currentUserId = '';
    }

    setMarkerUserId(currentUserId);
    bootedUserId = currentUserId;
    loadShoppingRuntimes();
  }

  let authSubscription = null;
  if (db?.auth?.onAuthStateChange) {
    const result = db.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = String(nextSession?.user?.id || '');

      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        setMarkerUserId(nextUserId || bootedUserId || null);
        return;
      }
      if (event === 'INITIAL_SESSION') return;
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;

      if (bootedUserId === null) {
        setMarkerUserId(nextUserId || null);
        return;
      }
      if (nextUserId === bootedUserId) {
        setMarkerUserId(nextUserId || null);
        return;
      }

      bootedUserId = nextUserId;
      handleIdentityChange(nextUserId);
    });
    authSubscription = result?.data?.subscription || null;
  }

  window.addEventListener('pagehide', () => authSubscription?.unsubscribe?.(), { once:true });

  boot().catch((error) => {
    console.warn('slevao_shopping_boot_failed', error);
    setMarkerUserId(null);
    loadShoppingRuntimes();
  });
})();
