(() => {
  'use strict';

  const mobile = window.matchMedia('(max-width: 800px)');
  const VIEWPORT_GAP = 12;

  function scrollLeafletsToReferencePosition() {
    if (!mobile.matches) return;

    const section = document.getElementById('leafletsSection');
    if (!section) return;

    document.body.classList.add('showOriginalLeaflets');

    const target = section.querySelector('.sectionHead p')
      || section.querySelector('.sectionHead')
      || section;
    const topbar = document.querySelector('.topbar');
    const fixedTop = topbar ? topbar.getBoundingClientRect().bottom : 0;
    const targetTop = target.getBoundingClientRect().top;
    const scrollTop = window.scrollY + targetTop - fixedTop - VIEWPORT_GAP;

    const leafletGrid = document.getElementById('leafletGrid');
    if (leafletGrid) {
      leafletGrid.scrollTo({ left: 0, behavior: 'auto' });
    }

    window.scrollTo({
      top: Math.max(0, scrollTop),
      behavior: 'smooth'
    });

    if (window.location.hash !== '#leafletsSection') {
      history.replaceState(null, '', '#leafletsSection');
    }
  }

  function settlePosition() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollLeafletsToReferencePosition();
        window.setTimeout(scrollLeafletsToReferencePosition, 180);
      });
    });
  }

  function attach() {
    const link = document.querySelector('.mobileNav a[href="#leafletsSection"]');
    if (!link || link.dataset.leafletPositionBound === '1') return;

    link.dataset.leafletPositionBound = '1';
    link.addEventListener('click', (event) => {
      if (!mobile.matches) return;
      event.preventDefault();
      event.stopPropagation();
      settlePosition();
    }, true);
  }

  attach();
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
})();
