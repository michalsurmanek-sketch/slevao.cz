(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';
  const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';
  const RUNTIME_URLS = [
    'assets/shopping-list.js?v=20260822-2',
    'assets/shopping-insights.js?v=20260821-1',
    'assets/shopping-route.js?v=20260815-4',
    'assets/shopping-route-autostart.js?v=20260807-1'
  ];
  const sharedParams = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedParams.get('share') || sharedHash.get('share'));
  const db = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  let bootedUserId = null;
  let runtimesLoading = null;
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

  function loadScript(url) {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Shopping runtime se nepodařilo načíst: ${url}`));
      document.head.appendChild(script);
    });
  }

  function loadShoppingRuntimes() {
    if (runtimesLoading) return runtimesLoading;
    runtimesLoading = RUNTIME_URLS.reduce(
      (chain, url) => chain.then(() => loadScript(url)),
      Promise.resolve()
    );
    return runtimesLoading;
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
      setMarkerUserId(null);
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
    await loadShoppingRuntimes();
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
  });
})();
