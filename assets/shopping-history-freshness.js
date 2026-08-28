(() => {
  'use strict';

  const HISTORY_KEY = 'slevao-shopping-history-v1';
  const CHECK_THROTTLE_MS = 1500;
  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  if (sharedMode || !document.querySelector('.sfListLayout')) return;

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db) return;

  let checking = false;
  let reloadScheduled = false;
  let lastCheckAt = 0;

  function historyContainer() {
    return document.getElementById('shoppingHistory');
  }

  function domPurchaseIds() {
    const container = historyContainer();
    if (!container || container.querySelector('.sfInsightsLoading')) return null;
    return [...container.querySelectorAll('[data-purchase-id]')]
      .map((card) => String(card?.dataset?.purchaseId || '').trim())
      .filter(Boolean);
  }

  function localPurchaseIds() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(value)) return [];
      return value.slice(0, 30)
        .map((purchase) => String(purchase?.id || '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function cloudPurchaseIds(userId) {
    const { data, error } = await db.from('shopping_list_purchases')
      .select('id')
      .eq('user_id', userId)
      .order('completed_at', { ascending:false })
      .limit(30);
    if (error) throw error;
    return (data || [])
      .map((purchase) => String(purchase?.id || '').trim())
      .filter(Boolean);
  }

  function sameIds(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  async function check({ force = false } = {}) {
    if (checking || reloadScheduled || document.hidden) return false;
    const now = Date.now();
    if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) return false;
    lastCheckAt = now;

    const visibleIds = domPurchaseIds();
    if (visibleIds === null) return false;

    checking = true;
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      const userId = String(data?.session?.user?.id || '').trim();
      const currentIds = userId ? await cloudPurchaseIds(userId) : localPurchaseIds();
      if (sameIds(visibleIds, currentIds)) return false;

      reloadScheduled = true;
      location.reload();
      return true;
    } catch (error) {
      console.debug('Kontrola historie nákupů selhala:', error);
      return false;
    } finally {
      checking = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check({ force:true });
  });
  window.addEventListener('focus', () => check());
  window.addEventListener('storage', (event) => {
    if (event?.key === HISTORY_KEY) check({ force:true });
  });
  window.setTimeout(() => check({ force:true }), 1200);

  window.SlevaoShoppingHistoryFreshness = {
    domPurchaseIds,
    localPurchaseIds,
    cloudPurchaseIds,
    sameIds,
    check
  };
})();
