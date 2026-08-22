(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const SHOPPING_LIST_SRC = 'assets/shopping-list.js?v=20260822-2';
  const sharedParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedQuery = new URLSearchParams(location.search);
  const sharedMode = Boolean(sharedParams.get('share') || sharedQuery.get('share'));
  let hydratedUserId = '';
  let authSubscription = null;
  let reloadQueued = false;

  function setListOwner(userId) {
    const normalized = String(userId || '').trim();
    try {
      if (normalized) localStorage.setItem(ACTIVE_USER_KEY, normalized);
      else localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {}
    window.SlevaoPublic?.updateNavCount?.();
  }

  function loadShoppingListRuntime() {
    if (document.querySelector('script[src*="shopping-list.js"]')) return;
    const script = document.createElement('script');
    script.src = SHOPPING_LIST_SRC;
    script.async = false;
    document.head.appendChild(script);
  }

  function scheduleIdentityReload(nextUserId) {
    setListOwner(nextUserId || null);
    if (sharedMode || reloadQueued) return;
    reloadQueued = true;
    location.reload();
  }

  async function bootstrap() {
    if (!window.supabase?.createClient) {
      loadShoppingListRuntime();
      return;
    }

    const authClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    let currentSession = null;
    try {
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      currentSession = data?.session || null;
    } catch {
      currentSession = null;
    }

    hydratedUserId = String(currentSession?.user?.id || '');
    setListOwner(hydratedUserId || null);
    loadShoppingListRuntime();

    const { data } = authClient.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = String(nextSession?.user?.id || '');

      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        setListOwner(nextUserId || hydratedUserId || null);
        return;
      }

      if (event === 'INITIAL_SESSION') {
        if (nextUserId === hydratedUserId) return;
        hydratedUserId = nextUserId;
        scheduleIdentityReload(nextUserId);
        return;
      }

      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      if (nextUserId === hydratedUserId) {
        setListOwner(nextUserId || null);
        return;
      }
      hydratedUserId = nextUserId;
      scheduleIdentityReload(nextUserId);
    });
    authSubscription = data?.subscription || null;
  }

  window.addEventListener('pagehide', () => authSubscription?.unsubscribe?.(), { once:true });
  bootstrap().catch(() => loadShoppingListRuntime());
})();
