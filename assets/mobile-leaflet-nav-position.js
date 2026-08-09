(() => {
  'use strict';

  /*
   * Jediný zdroj pravdy pro tlačítko „Letáky“ v mobilní navigaci.
   * Na webu existují dvě mobilní navigace (.mobileNav a .slevaoBottomNav),
   * proto opravujeme obě a nenecháváme žádný handler scrollovat na #leafletsSection.
   */
  const mobile = window.matchMedia('(max-width: 800px)');
  const LEAFLETS_URL = '/letaky.html';

  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

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

  function patchLeafletsLinks(root = document) {
    root.querySelectorAll?.('.mobileNav a, .slevaoBottomNav a').forEach((link) => {
      if (!isLeafletsLink(link)) return;
      link.setAttribute('href', LEAFLETS_URL);
      link.dataset.slevaoLeafletsPage = '1';
      link.removeAttribute('aria-current');
      link.classList.remove('active');
    });
  }

  function installHomeScrollTop() {
    const path = location.pathname.replace(/\/+$/, '');
    if (path && !path.endsWith('/index.html')) return;
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
  patchLeafletsLinks();
  installHomeScrollTop();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.mobileNav,.slevaoBottomNav,.mobileNav a,.slevaoBottomNav a')) patchLeafletsLinks(node.parentElement || node);
        else patchLeafletsLinks(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  /* Capture fáze: proběhne před běžnými click handlery, které dříve dělaly scroll. */
  document.addEventListener('click', (event) => {
    if (!mobile.matches) return;

    const link = event.target.closest('.mobileNav a, .slevaoBottomNav a');
    if (!link || !isLeafletsLink(link)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    link.blur?.();
    window.location.assign(LEAFLETS_URL);
  }, true);
})();
