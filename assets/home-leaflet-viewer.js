(() => {
  'use strict';

  function isDocumentUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin === location.origin && /\.html(?:[?#]|$)/i.test(url.pathname)) return false;
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('#leafletGrid .leafletAction a');
    if (!link) return;
    const source = link.href;
    if (!isDocumentUrl(source)) return;

    const card = link.closest('.leafletCard');
    const store = card?.querySelector('.leafletStoreIdentity h3, .leafletBody h3')?.textContent?.trim() || 'Obchod';
    const title = 'Aktuální leták';
    const params = new URLSearchParams({ src: source, store, title });
    const target = `letak-viewer.html?${params.toString()}`;

    event.preventDefault();
    event.stopImmediatePropagation();
    const opened = window.open(target, '_blank', 'noopener');
    if (!opened) window.location.href = target;
  }, true);
})();
