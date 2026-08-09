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

  installVisualFix();
  patchLeafletsLinks();

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
