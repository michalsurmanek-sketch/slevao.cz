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
  const GAP = 10;
  let correctionTimer = 0;

  function leafletTarget() {
    const section = document.getElementById('leafletsSection');
    if (!section) return null;

    return section.querySelector('.sectionHead p')
      || section.querySelector('.sectionHead')
      || section;
  }

  function alignLeaflets() {
    if (!mobile.matches) return;

    const target = leafletTarget();
    if (!target) return;

    const topbar = document.querySelector('.topbar');
    const desiredViewportTop = (topbar ? topbar.getBoundingClientRect().bottom : 0) + GAP;
    const currentViewportTop = target.getBoundingClientRect().top;
    const delta = currentViewportTop - desiredViewportTop;

    if (Math.abs(delta) > 1) {
      window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
    }
  }

  function openLeafletsFromBottomNav() {
    document.body.classList.add('showOriginalLeaflets');

    const grid = document.getElementById('leafletGrid');
    if (grid) grid.scrollLeft = 0;

    window.clearTimeout(correctionTimer);

    // Počkej, až se projeví showOriginalLeaflets a dokončí aktuální layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        alignLeaflets();
        if (window.location.hash !== '#leafletsSection') {
          history.replaceState(null, '', '#leafletsSection');
        }
      });
    });

    // Jediné tiché dorovnání proti případnému layout shiftu obrázků.
    correctionTimer = window.setTimeout(alignLeaflets, 220);
  }

  // Jeden jediný capture handler pro tlačítko Letáky. Funguje i když se nav později překreslí.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('.mobileNav a[href="#leafletsSection"]');
    if (!link || !mobile.matches) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openLeafletsFromBottomNav();
  }, true);
})();
