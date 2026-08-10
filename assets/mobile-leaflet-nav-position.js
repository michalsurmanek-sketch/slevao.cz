(() => {
  'use strict';

  if (!document.querySelector('link[href*="home-nearby-mobile-collapse.css"]')) {
    const nearbyStyle = document.createElement('link');
    nearbyStyle.rel = 'stylesheet';
    nearbyStyle.href = 'assets/home-nearby-mobile-collapse.css?v=20260810-1';
    document.head.appendChild(nearbyStyle);
  }

  if (!document.querySelector('script[src*="home-nearby-mobile-collapse.js"]')) {
    const nearbyScript = document.createElement('script');
    nearbyScript.src = 'assets/home-nearby-mobile-collapse.js?v=20260810-1';
    nearbyScript.defer = true;
    document.head.appendChild(nearbyScript);
  }

  /*
   * Mobilní navigace homepage: Letáky vždy otevírají /letaky.html,
   * Hledat na homepage pouze posune stránku na řádek rychlých potravin
   * nad sekcí Nejvýhodnější právě teď. Vyhledávací pole se samo neaktivuje.
   */
  const mobile = window.matchMedia('(max-width: 800px)');
  const LEAFLETS_URL = '/letaky.html';

  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function isHomePage() {
    const path = location.pathname.replace(/\/+$/, '');
    return path === '' || path === '/' || path.endsWith('/index.html');
  }

  function isLeafletsLink(link) {
    if (!link) return false;
    const text = fold(`${link.textContent || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('title') || ''}`);
    const href = link.getAttribute('href') || '';
    return text.includes('letaky')
      || href === '#leafletsSection'
      || href.endsWith('#leafletsSection')
      || href === 'letaky.html'
      || href === '/letaky.html'
      || href.endsWith('/letaky.html');
  }

  function isSearchLink(link) {
    if (!link) return false;
    const text = fold(`${link.textContent || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('title') || ''}`);
    return text.includes('hledat');
  }

  function installVisualFix() {
    if (document.getElementById('slevaoMobileNavFinalFix')) return;
    const style = document.createElement('style');
    style.id = 'slevaoMobileNavFinalFix';
    style.textContent = `
      @media(max-width:800px){
        .mobileNav a,.mobileNav button,
        .slevaoBottomNav a{
          -webkit-tap-highlight-color:transparent!important;
        }
        .mobileNav a:focus,.mobileNav button:focus,
        .mobileNav a:focus-visible,.mobileNav button:focus-visible,
        .mobileNav a:active,.mobileNav button:active,
        .slevaoBottomNav a:focus,.slevaoBottomNav a:focus-visible,.slevaoBottomNav a:active{
          outline:0!important;
          box-shadow:none!important;
        }
        .mobileNav a[aria-current="page"],
        .mobileNav button[aria-current="page"],
        .slevaoBottomNav a.active{
          background:transparent!important;
          box-shadow:none!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function patchNavigationLinks(root = document) {
    root.querySelectorAll?.('.mobileNav a, .slevaoBottomNav a').forEach((link) => {
      if (isLeafletsLink(link)) {
        link.setAttribute('href', LEAFLETS_URL);
        link.dataset.slevaoLeafletsPage = '1';
        link.removeAttribute('aria-current');
        link.classList.remove('active');
        return;
      }

      if (isHomePage() && isSearchLink(link)) {
        link.setAttribute('href', '#dealsSection');
        link.dataset.slevaoHomeSearch = '1';
        link.removeAttribute('aria-current');
        link.classList.remove('active');
      }
    });
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

  function installHomeScrollTop() {
    if (!isHomePage()) return;
    if (document.getElementById('leafletsScrollTop')) return;

    if (!document.querySelector('link[href*="leaflets-scroll-top.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'assets/leaflets-scroll-top.css?v=20260809-1';
      document.head.appendChild(link);
    }

    const button = document.createElement('button');
    button.id = 'leafletsScrollTop';
    button.className = 'leafletsScrollTop';
    button.type = 'button';
    button.setAttribute('aria-label', 'Nahoru');
    button.title = 'Nahoru';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
    document.body.appendChild(button);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const refresh = () => {
      frame = 0;
      if (!mobile.matches) {
        button.classList.remove('is-visible');
        return;
      }

      const top = window.scrollY || document.documentElement.scrollTop || 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.max(0, Math.min(1, top / max));
      button.style.setProperty('--scroll-progress', `${Math.round(progress * 360)}deg`);
      button.classList.toggle('is-visible', top > 420);
    };

    const scheduleRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    };

    button.addEventListener('click', () => {
      button.blur();
      window.scrollTo({ top: 0, left: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });

    window.addEventListener('scroll', scheduleRefresh, { passive: true });
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', scheduleRefresh);
    refresh();
  }

  installVisualFix();
  patchNavigationLinks();
  installHomeScrollTop();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.mobileNav,.slevaoBottomNav,.mobileNav a,.slevaoBottomNav a')) patchNavigationLinks(node.parentElement || node);
        else patchNavigationLinks(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  /* Capture fáze proběhne před staršími handlery, které měnily URL nebo scroll. */
  document.addEventListener('click', (event) => {
    if (!mobile.matches) return;

    const link = event.target.closest('.mobileNav a, .slevaoBottomNav a');
    if (!link) return;

    if (isHomePage() && isSearchLink(link)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      link.blur?.();
      scrollToHomeSearchPosition();
      return;
    }

    if (!isLeafletsLink(link)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    link.blur?.();
    window.location.assign(LEAFLETS_URL);
  }, true);
})();
