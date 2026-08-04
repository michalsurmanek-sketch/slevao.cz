(() => {
  'use strict';

  function upgrade() {
    const nav = document.querySelector('.slevaoBottomNav');
    if (!nav) return false;
    const links = [...nav.querySelectorAll('a')];
    const search = links.find((link) => /Hledat/i.test(link.textContent || '')) || links[1];
    if (search) {
      search.href = 'hledat.html';
      search.classList.toggle('active', location.pathname.endsWith('/hledat.html') || location.pathname === '/hledat.html');
    }
    if (location.pathname.endsWith('/hledat.html') || location.pathname === '/hledat.html') {
      links.forEach((link) => { if (link !== search) link.classList.remove('active'); });
    }
    return true;
  }

  if (upgrade()) return;
  const observer = new MutationObserver(() => {
    if (upgrade()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 8000);
})();
