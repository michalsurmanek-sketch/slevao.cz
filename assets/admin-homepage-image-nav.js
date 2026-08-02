(() => {
  'use strict';
  if (window.__slevaoHomepageImageNavLoaded) return;
  window.__slevaoHomepageImageNavLoaded = true;

  function createLink(href, label, icon = '▤') {
    const link = document.createElement('a');
    link.href = href;
    link.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span>`;
    link.dataset.uiIconized = 'true';
    return link;
  }

  const addLink = () => {
    const nav = document.querySelector('.side .nav');
    if (nav && !nav.querySelector('a[href="admin-obrazky-letaku.html"]')) {
      const target = nav.querySelector('a[href="admin-fotografie.html"]') || nav.querySelector('a[href="index.html"]');
      const link = createLink('admin-obrazky-letaku.html', 'Obrázky letáků');
      if (target) nav.insertBefore(link, target);
      else nav.append(link);
    }
    if (nav && !nav.querySelector('a[href="admin-viditelnost-letaku.html"]')) {
      const imageLink = nav.querySelector('a[href="admin-obrazky-letaku.html"]');
      const link = createLink('admin-viditelnost-letaku.html', 'Viditelnost letáků', '◉');
      if (imageLink?.nextSibling) nav.insertBefore(link, imageLink.nextSibling);
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
    if (quick && !quick.querySelector('a[href="admin-viditelnost-letaku.html"]')) {
      const link = document.createElement('a');
      link.className = 'btn light';
      link.href = 'admin-viditelnost-letaku.html';
      link.textContent = '◉ Viditelnost letáků na hlavní stránce';
      const imageLink = quick.querySelector('a[href="admin-obrazky-letaku.html"]');
      if (imageLink?.nextSibling) quick.insertBefore(link, imageLink.nextSibling);
      else quick.append(link);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLink, { once: true });
  else addLink();
  new MutationObserver(addLink).observe(document.documentElement, { childList: true, subtree: true });
})();
