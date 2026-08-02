(() => {
  'use strict';
  if (window.__slevaoHomepageImageNavLoaded) return;
  window.__slevaoHomepageImageNavLoaded = true;

  const addLink = () => {
    const nav = document.querySelector('.side .nav');
    if (nav && !nav.querySelector('a[href="admin-obrazky-letaku.html"]')) {
      const target = nav.querySelector('a[href="admin-fotografie.html"]') || nav.querySelector('a[href="index.html"]');
      const link = document.createElement('a');
      link.href = 'admin-obrazky-letaku.html';
      link.innerHTML = '<span aria-hidden="true">▤</span><span>Obrázky letáků</span>';
      link.dataset.uiIconized = 'true';
      if (target) nav.insertBefore(link, target);
      else nav.append(link);
    }

    const quick = document.querySelector('#dashboard .toolbar');
    if (quick && !quick.querySelector('a[href="admin-obrazky-letaku.html"]')) {
      const link = document.createElement('a');
      link.className = 'btn light';
      link.href = 'admin-obrazky-letaku.html';
      link.textContent = '▤ Obrázky letáků na hlavní stránce';
      const target = quick.querySelector('a[href="admin-fotografie.html"]');
      if (target) quick.insertBefore(link, target);
      else quick.append(link);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLink, { once: true });
  else addLink();
  new MutationObserver(addLink).observe(document.documentElement, { childList: true, subtree: true });
})();
