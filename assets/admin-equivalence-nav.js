(() => {
  'use strict';

  function ensureLinks() {
    const nav = document.querySelector('.nav');
    if (nav && !nav.querySelector('a[href="admin-ekvivalence-produktu.html"]')) {
      const link = document.createElement('a');
      link.href = 'admin-ekvivalence-produktu.html';
      link.textContent = '🔗 Ekvivalence produktů';
      const before = nav.querySelector('a[href="index.html"]');
      nav.insertBefore(link, before || null);
    }

    const toolbar = document.querySelector('#dashboard .toolbar');
    if (toolbar && !toolbar.querySelector('a[href="admin-ekvivalence-produktu.html"]')) {
      const link = document.createElement('a');
      link.href = 'admin-ekvivalence-produktu.html';
      link.className = 'btn light';
      link.textContent = '🔗 Ekvivalence produktů';
      const before = toolbar.querySelector('a[href="index.html"]');
      toolbar.insertBefore(link, before || null);
    }
  }

  function init() {
    ensureLinks();
    new MutationObserver(ensureLinks).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
