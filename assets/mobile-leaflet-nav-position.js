(() => {
  'use strict';

  const mobile = window.matchMedia('(max-width: 800px)');

  function scrollLeafletsToReferencePosition() {
    if (!mobile.matches) return;

    const section = document.getElementById('leafletsSection');
    if (!section) return;

    document.body.classList.add('showOriginalLeaflets');

    const target = section.querySelector('.sectionHead p')
      || section.querySelector('.sectionHead')
      || section;
    const topbar = document.querySelector('.topbar');
    const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const top = window.scrollY + target.getBoundingClientRect().top - headerHeight - 6;

    window.scrollTo({
      top: Math.max(0, top),
      behavior: 'smooth'
    });

    if (window.location.hash !== '#leafletsSection') {
      history.replaceState(null, '', '#leafletsSection');
    }
  }

  function attach() {
    const link = document.querySelector('.mobileNav a[href="#leafletsSection"]');
    if (!link || link.dataset.leafletPositionBound === '1') return;

    link.dataset.leafletPositionBound = '1';
    link.addEventListener('click', (event) => {
      if (!mobile.matches) return;
      event.preventDefault();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scrollLeafletsToReferencePosition);
      });
    });
  }

  attach();
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
})();
