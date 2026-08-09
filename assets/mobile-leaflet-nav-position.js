(() => {
  'use strict';

  /* Sdílení produktové karty – načteno zde, aby fungovalo na mobilu i desktopu bez zásahu do rendererů. */
  if (!document.querySelector('link[href*="product-card-share.css"]')) {
    const shareStyle = document.createElement('link');
    shareStyle.rel = 'stylesheet';
    shareStyle.href = 'assets/product-card-share.css?v=20260809-1';
    document.head.appendChild(shareStyle);
  }

  if (!document.querySelector('script[src*="product-card-share.js"]')) {
    const shareScript = document.createElement('script');
    shareScript.src = 'assets/product-card-share.js?v=20260809-1';
    shareScript.async = false;
    document.head.appendChild(shareScript);
  }

  /* Vlastní výběr okruhu – šířka pro celé „15 km“ a dropdown v designu Slevao.cz. */
  if (!document.querySelector('link[href*="home-radius-select.css"]')) {
    const radiusStyle = document.createElement('link');
    radiusStyle.rel = 'stylesheet';
    radiusStyle.href = 'assets/home-radius-select.css?v=20260809-1';
    document.head.appendChild(radiusStyle);
  }

  if (!document.querySelector('script[src*="home-radius-select.js"]')) {
    const radiusScript = document.createElement('script');
    radiusScript.src = 'assets/home-radius-select.js?v=20260809-1';
    radiusScript.async = false;
    document.head.appendChild(radiusScript);
  }

  const mobile = window.matchMedia('(max-width: 800px)');
  const ALL_LEAFLETS_URL = 'letaky.html';

  function patchLeafletsLink() {
    document.querySelectorAll('.mobileNav a[href="#leafletsSection"], .mobileNav a[href$="#leafletsSection"]').forEach((link) => {
      link.href = ALL_LEAFLETS_URL;
      link.dataset.leafletsAllPage = '1';
    });
  }

  patchLeafletsLink();

  const navObserver = new MutationObserver(patchLeafletsLink);
  navObserver.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    if (!mobile.matches) return;

    const link = event.target.closest('.mobileNav a');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    const isLeafletsLink = link.dataset.leafletsAllPage === '1'
      || href === '#leafletsSection'
      || href.endsWith('#leafletsSection')
      || href === ALL_LEAFLETS_URL
      || href.endsWith(`/${ALL_LEAFLETS_URL}`);

    if (!isLeafletsLink) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.href = ALL_LEAFLETS_URL;
  }, true);
})();
