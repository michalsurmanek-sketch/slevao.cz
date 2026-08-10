(() => {
  'use strict';

  const input = document.getElementById('leafletsStoreSearchInput');
  const section = document.querySelector('.leafletsStoreSearchSection');
  const topbar = document.querySelector('.leafletsTopbar');
  if (!section) return;

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

    window.scrollTo({ top: target, left: 0, behavior });
  }

  function lockSearchPosition() {
    if (!isMobile()) return;
    clearTimers();

    alignSearch('smooth');
    [90, 220, 420, 700].forEach((delay) => {
      timers.push(window.setTimeout(() => alignSearch('auto'), delay));
    });
  }

  if (input) {
    input.addEventListener('pointerdown', lockSearchPosition, { capture: true });
    input.addEventListener('focus', lockSearchPosition, { capture: true });
  }

  function isNavSearch(link) {
    return Boolean(link && /Hledat/i.test(link.textContent || ''));
  }

  function patchNavSearch() {
    document.querySelectorAll('.slevaoBottomNav a').forEach((link) => {
      if (!isNavSearch(link)) return;
      link.setAttribute('href', '#leafletsStoreSearch');
      link.dataset.leafletsSearchScroll = '1';
      link.removeAttribute('aria-current');
      link.classList.remove('active');
    });
  }

  patchNavSearch();

  document.addEventListener('click', (event) => {
    if (!isMobile()) return;
    const link = event.target.closest('.slevaoBottomNav a');
    if (!isNavSearch(link)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    link.blur?.();
    input?.blur?.();
    lockSearchPosition();
  }, true);

  const observer = new MutationObserver(patchNavSearch);
  observer.observe(document.body, { childList: true, subtree: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (!input || document.activeElement !== input || !isMobile()) return;
      window.requestAnimationFrame(() => alignSearch('auto'));
    });
  }
})();
