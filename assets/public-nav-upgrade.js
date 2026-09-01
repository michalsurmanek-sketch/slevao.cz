(() => {
  'use strict';

  const LEAFLETS_URL = 'letaky.html';
  const HOME_SEARCH_TARGET = '#dealsSection';
  const LEGACY_LIST_KEY = 'slevao-shopping-list-v1';
  const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const SEARCH_JUMP_KEY = 'slevao-search-jump-to-results';
  const isHomePage = () => {
    const path = location.pathname.replace(/\/+$/, '');
    return path === '' || path === '/' || path.endsWith('/index.html');
  };

  function installShoppingListOwnerBridge() {
    if (Storage.prototype.__slevaoShoppingListOwnerBridge) return;

    const nativeGetItem = Storage.prototype.getItem;
    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    const parseRows = (raw) => {
      try {
        const value = JSON.parse(raw || '[]');
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    };
    const normalizedName = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const rowKey = (row) => row?.product_id
      ? `p:${String(row.product_id)}`
      : (normalizedName(row?.custom_name || row?.name) ? `c:${normalizedName(row?.custom_name || row?.name)}` : '');
    const activeUserId = () => String(nativeGetItem.call(window.localStorage, ACTIVE_USER_KEY) || '').trim();
    const activeOwner = () => activeUserId() ? `user:${activeUserId()}` : 'guest';
    const storageKey = (owner = activeOwner()) => `${LIST_KEY_PREFIX}${String(owner || 'guest')}`;

    const migrateLegacyGuest = () => {
      const guestKey = storageKey('guest');
      if (nativeGetItem.call(window.localStorage, guestKey) !== null) return;
      const legacyRaw = nativeGetItem.call(window.localStorage, LEGACY_LIST_KEY);
      if (legacyRaw === null) return;
      const legacyRows = parseRows(legacyRaw);
      if (legacyRows.some((row) => row?.server_id)) return;
      nativeSetItem.call(window.localStorage, guestKey, JSON.stringify(legacyRows));
      nativeRemoveItem.call(window.localStorage, LEGACY_LIST_KEY);
    };

    const mergeGuestRows = (currentRows, guestRows) => {
      const merged = (Array.isArray(currentRows) ? currentRows : []).map((row) => ({ ...row }));
      const byKey = new Map(merged.map((row) => [rowKey(row), row]).filter(([key]) => key));
      for (const source of Array.isArray(guestRows) ? guestRows : []) {
        const key = rowKey(source);
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          existing.quantity = Math.max(Number(existing.quantity || 1), Number(source.quantity || 1));
          existing.completed = Boolean(existing.completed && source.completed);
          continue;
        }
        const copy = { ...source, local_id: source.local_id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` };
        delete copy.server_id;
        merged.push(copy);
        byKey.set(key, copy);
      }
      return merged;
    };

    const claimGuestForUser = (userId) => {
      const normalized = String(userId || '').trim();
      if (!normalized) return;
      migrateLegacyGuest();
      const guestKey = storageKey('guest');
      const guestRows = parseRows(nativeGetItem.call(window.localStorage, guestKey));
      if (!guestRows.length) return;
      const userKey = storageKey(`user:${normalized}`);
      const currentRows = parseRows(nativeGetItem.call(window.localStorage, userKey));
      nativeSetItem.call(window.localStorage, userKey, JSON.stringify(mergeGuestRows(currentRows, guestRows)));
      nativeRemoveItem.call(window.localStorage, guestKey);
    };

    migrateLegacyGuest();

    Object.defineProperty(Storage.prototype, '__slevaoShoppingListOwnerBridge', {
      value: true,
      configurable: true
    });

    Storage.prototype.getItem = function getItem(key) {
      if (this === window.localStorage && key === LEGACY_LIST_KEY) {
        return nativeGetItem.call(this, storageKey());
      }
      return nativeGetItem.call(this, key);
    };

    Storage.prototype.setItem = function setItem(key, value) {
      if (this === window.localStorage && key === ACTIVE_USER_KEY) {
        const nextUserId = String(value || '').trim();
        if (nextUserId && !activeUserId()) claimGuestForUser(nextUserId);
        return nativeSetItem.call(this, key, String(value));
      }
      if (this === window.localStorage && key === LEGACY_LIST_KEY) {
        return nativeSetItem.call(this, storageKey(), String(value));
      }
      return nativeSetItem.call(this, key, String(value));
    };

    Storage.prototype.removeItem = function removeItem(key) {
      if (this === window.localStorage && key === LEGACY_LIST_KEY) {
        return nativeRemoveItem.call(this, storageKey());
      }
      return nativeRemoveItem.call(this, key);
    };

    window.SlevaoListOwnerBridge = { activeOwner, storageKey, migrateLegacyGuest, claimGuestForUser };
  }

  function loadPersonalization() {
    if (!document.querySelector('link[href*="product-personalization.css"]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'assets/product-personalization.css?v=20260816-4';
      document.head.appendChild(style);
    }
    if (document.querySelector('script[src*="product-personalization.js"]')) return;

    let attempts = 0;
    const attach = () => {
      if (document.querySelector('script[src*="product-personalization.js"]')) return;
      if (!window.supabase && attempts++ < 80) {
        window.setTimeout(attach, 100);
        return;
      }
      if (!window.supabase) return;
      const script = document.createElement('script');
      script.src = 'assets/product-personalization.js?v=20260827-3';
      script.defer = true;
      document.head.appendChild(script);
    };
    attach();
  }

  function loadPwa() {
    if (document.querySelector('script[src*="pwa-install.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/pwa-install.js?v=20260901-1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadLocationService() {
    if (document.querySelector('script[src*="location-service.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/location-service.js?v=20260821-1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadStoreArrivalCopyVariation() {
    if (document.querySelector('script[src*="store-arrival-copy-variation.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/store-arrival-copy-variation.js?v=20260811-2';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadStoreArrivalAlerts() {
    if (!isHomePage() && !document.querySelector('link[href*="store-arrival-alerts.css"]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'assets/store-arrival-alerts.css?v=20260811-1';
      document.head.appendChild(style);
    }
    if (document.querySelector('script[src*="store-arrival-alerts.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/store-arrival-alerts.js?v=20260811-3';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadStoreArrivalTest() {
    if (document.querySelector('script[src*="store-arrival-test.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/store-arrival-test.js?v=20260811-5';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadHomePersonalDeals() {
    if (!/\/(?:index\.html)?$/i.test(location.pathname)) return;
    if (document.querySelector('script[src*="home-personal-deals.js"]')) return;
    let attempts = 0;
    const attach = () => {
      if (document.querySelector('script[src*="home-personal-deals.js"]')) return;
      if ((!window.supabase || !window.SlevaoSupabase?.getClient) && attempts++ < 80) {
        window.setTimeout(attach, 100);
        return;
      }
      if (!window.supabase || !window.SlevaoSupabase?.getClient) return;
      const script = document.createElement('script');
      script.src = 'assets/home-personal-deals.js?v=20260825-1';
      script.defer = true;
      document.head.appendChild(script);
    };
    attach();
  }

  function installMobileNavVisualFix() {
    if (document.getElementById('slevaoMobileNavNoActiveBox')) return;
    const style = document.createElement('style');
    style.id = 'slevaoMobileNavNoActiveBox';
    style.textContent = `
      @media(max-width:720px){
        .slevaoBottomNav a,
        .slevaoBottomNav a:focus,
        .slevaoBottomNav a:focus-visible,
        .slevaoBottomNav a:active{
          outline:0!important;
          box-shadow:none!important;
          -webkit-tap-highlight-color:transparent!important;
        }
        .slevaoBottomNav a.active{
          background:transparent!important;
          box-shadow:none!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function upgrade() {
    const nav = document.querySelector('.slevaoBottomNav');
    if (!nav) return false;

    const links = [...nav.querySelectorAll('a')];
    const search = links.find((link) => /Hledat/i.test(link.textContent || '')) || links[1];
    const leaflets = links.find((link) => /Letáky/i.test(link.textContent || '')) || links[2];

    if (search) {
      if (isHomePage()) {
        search.href = HOME_SEARCH_TARGET;
        search.dataset.homeSearchScroll = '1';
        search.classList.remove('active');
        search.removeAttribute('aria-current');
      } else {
        search.href = 'index.html#dealsSection';
        search.removeAttribute('data-home-search-scroll');
        search.classList.remove('active');
      }
    }

    if (leaflets) {
      leaflets.href = LEAFLETS_URL;
      leaflets.removeAttribute('aria-current');
    }

    return true;
  }

  function scrollToHomeSearchPosition() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const align = (behavior = 'auto') => {
      const target = document.querySelector('.sqFoodDock') || document.getElementById('dealsSection');
      if (!target) return;

      const topbar = document.querySelector('.topbar');
      const topbarHeight = Math.ceil(topbar?.getBoundingClientRect().height || 0);
      const absoluteTop = window.scrollY + target.getBoundingClientRect().top;
      const targetTop = Math.max(0, Math.round(absoluteTop - topbarHeight - 14));

      window.scrollTo({ top: targetTop, left: 0, behavior });
    };

    align(reducedMotion ? 'auto' : 'smooth');
    window.setTimeout(() => align('auto'), reducedMotion ? 0 : 380);
  }

  function installCrossPageSearchJump() {
    const accountSearch = document.querySelector('form.accountSearch');
    if (accountSearch) {
      accountSearch.addEventListener('submit', (event) => {
        const input = accountSearch.querySelector('input[name="q"]');
        const query = String(input?.value || '').trim();
        if (!query) return;
        event.preventDefault();
        try { sessionStorage.setItem(SEARCH_JUMP_KEY, '1'); } catch {}
        window.location.assign(`index.html?q=${encodeURIComponent(query)}`);
      });
    }

    if (!isHomePage()) return;
    const query = String(new URLSearchParams(location.search).get('q') || '').trim();
    if (!query) return;

    let shouldJump = false;
    try {
      shouldJump = sessionStorage.getItem(SEARCH_JUMP_KEY) === '1';
      if (shouldJump) sessionStorage.removeItem(SEARCH_JUMP_KEY);
    } catch {}
    if (!shouldJump) return;

    const jump = () => {
      const target = document.getElementById('dealsSection');
      if (!target) return;
      if (location.hash !== '#dealsSection') location.hash = 'dealsSection';
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => window.setTimeout(jump, 80), { once:true });
    } else {
      window.setTimeout(jump, 80);
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('.slevaoBottomNav a');
    if (!link) return;

    if (/Letáky/i.test(link.textContent || '')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(LEAFLETS_URL);
      return;
    }

    if (isHomePage() && /Hledat/i.test(link.textContent || '')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      link.blur?.();
      scrollToHomeSearchPosition();
    }
  }, true);

  installShoppingListOwnerBridge();
  loadPersonalization();
  loadPwa();
  loadLocationService();
  loadStoreArrivalCopyVariation();
  loadStoreArrivalAlerts();
  loadStoreArrivalTest();
  loadHomePersonalDeals();
  installMobileNavVisualFix();
  installCrossPageSearchJump();

  if (upgrade()) return;
  const observer = new MutationObserver(() => {
    if (upgrade()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 8000);
})();
