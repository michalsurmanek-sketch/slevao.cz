(() => {
  'use strict';

  const LEAFLETS_URL = 'letaky.html';

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
      script.src = 'assets/product-personalization.js?v=20260804-2';
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
      search.href = 'hledat.html';
      search.classList.toggle('active', location.pathname.endsWith('/hledat.html') || location.pathname === '/hledat.html');
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

  document.addEventListener('click', (event) => {
    const link = event.target.closest('.slevaoBottomNav a');
    if (!link || !/Letáky/i.test(link.textContent || '')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.assign(LEAFLETS_URL);
  }, true);

  loadPersonalization();
  loadPwa();
  loadHomePersonalDeals();
  installMobileNavVisualFix();

  if (upgrade()) return;
  const observer = new MutationObserver(() => {
    if (upgrade()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 8000);
})();
