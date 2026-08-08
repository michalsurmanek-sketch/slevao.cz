(() => {
  'use strict';

  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const scrollToCurrentDeals = () => {
    const heading = document.querySelector('#dealsSection .dealsHeading') || document.getElementById('dealsSection');
    if (!heading) return;

    const topbar = document.querySelector('.topbar');
    const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const targetTop = window.scrollY + heading.getBoundingClientRect().top - headerHeight - 14;

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });

    if (window.location.hash !== '#dealsSection') {
      history.replaceState(null, '', '#dealsSection');
    }
  };

  document.addEventListener('click', (event) => {
    const control = event.target.closest('a,button');
    if (!control || control.id === 'topbarTipButton' || control.closest('.sqFoodDock')) return;

    const text = fold(`${control.textContent || ''} ${control.getAttribute('aria-label') || ''} ${control.getAttribute('title') || ''}`);
    const isCurrentDeals = text.includes('aktualni slev') || text.includes('aktualni nabid');
    if (!isCurrentDeals) return;

    const href = control.getAttribute('href') || '';
    const pointsToDeals = href === '#dealsSection' || href.endsWith('#dealsSection');
    if (!pointsToDeals && control.tagName === 'A') return;

    event.preventDefault();
    scrollToCurrentDeals();
  });
})();
