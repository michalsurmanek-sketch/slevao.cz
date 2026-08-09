(() => {
  'use strict';

  const mobile = window.matchMedia('(max-width: 800px)');
  const GAP = 10;
  let settleTimer = 0;

  function targetPosition() {
    const section = document.getElementById('leafletsSection');
    if (!section) return null;

    const target = section.querySelector('.sectionHead p')
      || section.querySelector('.sectionHead')
      || section;
    const topbar = document.querySelector('.topbar');
    const headerHeight = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
    const top = window.scrollY + target.getBoundingClientRect().top - headerHeight - GAP;

    return { top: Math.max(0, Math.round(top)), section };
  }

  function placeLeafletsExactly(updateHash = true) {
    if (!mobile.matches) return;

    const position = targetPosition();
    if (!position) return;

    document.body.classList.add('showOriginalLeaflets');

    const grid = document.getElementById('leafletGrid');
    if (grid) grid.scrollLeft = 0;

    window.scrollTo({ top: position.top, left: 0, behavior: 'auto' });

    if (updateHash && window.location.hash !== '#leafletsSection') {
      history.replaceState(null, '', '#leafletsSection');
    }
  }

  function settleLeafletPosition() {
    window.clearTimeout(settleTimer);

    // První přesné usazení po dokončení aktuálního layoutu.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => placeLeafletsExactly(true));
    });

    // Krátké dorovnání pouze proti layout shiftu při dokončení obrázků/fontů.
    settleTimer = window.setTimeout(() => placeLeafletsExactly(false), 120);
  }

  function bindLeafletNavigation() {
    const link = document.querySelector('.mobileNav a[href="#leafletsSection"]');
    if (!link || link.dataset.preciseLeafletScroll === '1') return;

    link.dataset.preciseLeafletScroll = '1';
    link.addEventListener('click', (event) => {
      if (!mobile.matches) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      settleLeafletPosition();
    }, true);
  }

  bindLeafletNavigation();
  new MutationObserver(bindLeafletNavigation).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
