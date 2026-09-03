(() => {
  'use strict';

  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';
  const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';
  const OWNER_CUSTOM_ADD_URL = 'assets/shopping-owner-custom-add-bridge.js?v=20260828-3';
  const SHARED_ADD_GUARD_URL = 'assets/shopping-shared-add-submit-guard.js?v=20260828-3';
  const LIST_URL = 'assets/shopping-list.js?v=20260903-1';
  const INSIGHTS_URL = 'assets/shopping-insights.js?v=20260828-1';
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedHash.get('share'));
  const db = window.SlevaoSupabase?.getClient?.();
  let bootedUserId = null;
  let ownerCustomAddLoaded = false;
  let sharedAddGuardLoaded = false;
  let listLoaded = false;
  let insightLoaded = false;
  let reloadQueued = false;
  let ownerPreflightDone = false;
  let resolveOwnerPreflight = null;

  const ownerPreflight = new Promise((resolve) => {
    resolveOwnerPreflight = resolve;
  });
  window.SlevaoShoppingOwnerPreflight = ownerPreflight;

  function finishOwnerPreflight() {
    if (ownerPreflightDone) return;
    ownerPreflightDone = true;
    resolveOwnerPreflight?.();
  }

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

  function installShareBridge() {
    if (typeof navigator === 'undefined' || !navigator.share || navigator.__slevaoShareBridge) return;

    const nativeShare = navigator.share.bind(navigator);
    const readListRows = () => [...document.querySelectorAll('#listItems [data-id]')]
      .filter((article) => !article.classList.contains('done'))
      .map((article) => {
        const name = String(article.querySelector('.sfItemName')?.textContent || '').trim();
        const quantityInput = article.querySelector('[data-quantity]');
        const rawQuantity = Number(quantityInput?.value || 1);
        const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
        return { name, quantity };
      })
      .filter((row) => row.name);

    const formatQuantity = (value) => Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
    const pieceLabel = (value) => Number(value) === 1 ? 'kus' : (Number(value) >= 2 && Number(value) <= 4 ? 'kusy' : 'kusů');
    const itemLabel = (value) => Number(value) === 1 ? 'položka' : (Number(value) >= 2 && Number(value) <= 4 ? 'položky' : 'položek');

    const enhancedShare = async (data = {}) => {
      const title = String(data?.title || '');
      const isShoppingList = title.toLocaleLowerCase('cs-CZ').includes('nákupní seznam slevao.cz');
      if (!isShoppingList) return nativeShare(data);

      const rows = readListRows();
      if (!rows.length) return nativeShare(data);

      const totalPieces = rows.reduce((sum, row) => sum + row.quantity, 0);
      const lines = rows.map((row) => `${formatQuantity(row.quantity)}× ${row.name}`);
      const url = String(data?.url || '').trim();
      const summary = `${rows.length} ${itemLabel(rows.length)} · ${formatQuantity(totalPieces)} ${pieceLabel(totalPieces)}`;
      const text = [
        'Nákupní seznam Slevao.cz',
        summary,
        '',
        ...lines,
        ...(url ? ['', 'Společný seznam:', url] : [])
      ].join('\n');

      return nativeShare({ title: 'Nákupní seznam Slevao.cz', text });
    };

    try {
      navigator.share = enhancedShare;
      Object.defineProperty(navigator, '__slevaoShareBridge', {
        value: true,
        configurable: true
      });
    } catch {
      try {
        Object.defineProperty(navigator, 'share', {
          value: enhancedShare,
          configurable: true
        });
        Object.defineProperty(navigator, '__slevaoShareBridge', {
          value: true,
          configurable: true
        });
      } catch {}
    }
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

  function loadOwnerCustomAddBridge() {
    if (ownerCustomAddLoaded || document.querySelector('script[src*="shopping-owner-custom-add-bridge.js"]')) return;
    ownerCustomAddLoaded = true;
    const script = document.createElement('script');
    script.src = OWNER_CUSTOM_ADD_URL;
    script.async = false;
    document.head.appendChild(script);
  }

  function loadSharedAddGuard() {
    if (sharedAddGuardLoaded || document.querySelector('script[src*="shopping-shared-add-submit-guard.js"]')) return;
    sharedAddGuardLoaded = true;
    const script = document.createElement('script');
    script.src = SHARED_ADD_GUARD_URL;
    script.async = false;
    document.head.appendChild(script);
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

  function loadCoreRuntimes() {
    loadOwnerCustomAddBridge();
    loadSharedAddGuard();
    loadList();
  }

  function loadShoppingRuntimes() {
    loadCoreRuntimes();
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
    installShareBridge();

    // Základ seznamu načti okamžitě. Cloudová příprava smí blokovat pouze
    // synchronizaci, nikdy vykreslení lokálně uložených položek.
    loadCoreRuntimes();

    if (!db) {
      finishOwnerPreflight();
      loadInsights();
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
    if (currentUserId) {
      try {
        const budgetReady = window.SlevaoShoppingBudgetConcurrencyReady;
        if (budgetReady && typeof budgetReady.then === 'function') await budgetReady;
        window.SlevaoShoppingBudgetConcurrency?.syncStorage?.();
      } catch {}
      try {
        await window.SlevaoShoppingOwnerColdSync?.sync?.(currentUserId);
      } catch (error) {
        console.debug('slevao_shopping_owner_cold_sync_failed', error);
      }
      try {
        await window.SlevaoShoppingGuestProductFallback?.sync?.();
      } catch (error) {
        console.debug('slevao_shopping_guest_product_fallback_failed', error);
      }
    }

    finishOwnerPreflight();
    loadInsights();
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
    loadCoreRuntimes();
  }).finally(() => {
    finishOwnerPreflight();
    loadInsights();
  });
})();
