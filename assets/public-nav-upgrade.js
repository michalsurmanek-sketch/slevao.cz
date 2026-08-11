(() => {
  'use strict';

  const LEAFLETS_URL = 'letaky.html';
  const HOME_SEARCH_TARGET = '#dealsSection';
  const isHomePage = () => {
    const path = location.pathname.replace(/\/+$/, '');
    return path === '' || path === '/' || path.endsWith('/index.html');
  };

  function loadPersonalization() {
    if (!document.querySelector('link[href*="product-personalization.css"]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'assets/product-personalization.css?v=20260804-2';
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
      script.src = 'assets/product-personalization.js?v=20260811-1';
      script.defer = true;
      document.head.appendChild(script);
    };
    attach();
  }

  function loadPwa() {
    if (document.querySelector('script[src*="pwa-install.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/pwa-install.js?v=20260804-1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadStoreArrivalAlerts() {
    if (!document.querySelector('link[href*="store-arrival-alerts.css"]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'assets/store-arrival-alerts.css?v=20260811-1';
      document.head.appendChild(style);
    }
    if (document.querySelector('script[src*="store-arrival-alerts.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/store-arrival-alerts.js?v=20260811-1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadStoreArrivalTest() {
    if (document.querySelector('script[src*="store-arrival-test.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/store-arrival-test.js?v=20260811-2';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadHomePersonalDeals() {
    if (!/\/(?:index\.html)?$/i.test(location.pathname)) return;
    if (document.querySelector('script[src*="home-personal-deals.js"]')) return;
    let attempts = 0;
    const attach = () => {
      if (document.querySelector('script[src*="home-personal-deals.js"]')) return;
      if (!window.supabase && attempts++ < 80) {
        window.setTimeout(attach, 100);
        return;
      }
      if (!window.supabase) return;
      const script = document.createElement('script');
      script.src = 'assets/home-personal-deals.js?v=20260804-1';
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
        search.href = 'hledat.html';
        search.removeAttribute('data-home-search-scroll');
        search.classList.toggle('active', location.pathname.endsWith('/hledat.html') || location.pathname === '/hledat.html');
      }
    }

    if (leaflets) {
      leaflets.href = LEAFLETS_URL;
      leaflets.removeAttribute('aria-current');
    }

    if (location.pathname.endsWith('/hledat.html') || location.pathname === '/hledat.html') {
      links.forEach((link) => { if (link !== search) link.classList.remove('active'); });
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

  loadPersonalization();
  loadPwa();
  loadStoreArrivalAlerts();
  loadStoreArrivalTest();
  loadHomePersonalDeals();
  installMobileNavVisualFix();

  if (upgrade()) return;
  const observer = new MutationObserver(() => {
    if (upgrade()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 8000);
})();
