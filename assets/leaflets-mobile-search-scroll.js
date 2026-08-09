(() => {
  'use strict';

  const input = document.getElementById('leafletsStoreSearchInput');
  const section = document.querySelector('.leafletsStoreSearchSection');
  const topbar = document.querySelector('.leafletsTopbar');
  if (!input || !section) return;

  const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
  let timers = [];

  function clearTimers() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  }

  function alignSearch(behavior = 'auto') {
    if (!isMobile()) return;

    const topbarHeight = Math.ceil(topbar?.getBoundingClientRect().height || 64);
    const sectionTop = window.scrollY + section.getBoundingClientRect().top;
    const target = Math.max(0, Math.round(sectionTop - topbarHeight - 8));

    window.scrollTo({ top: target, behavior });
  }

  function lockSearchPosition() {
    if (!isMobile()) return;
    clearTimers();

    alignSearch('smooth');
    [90, 220, 420, 700].forEach((delay) => {
      timers.push(window.setTimeout(() => alignSearch('auto'), delay));
    });
  }

  input.addEventListener('pointerdown', lockSearchPosition, { capture: true });
  input.addEventListener('focus', lockSearchPosition, { capture: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (document.activeElement !== input || !isMobile()) return;
      window.requestAnimationFrame(() => alignSearch('auto'));
    });
  }
})();
