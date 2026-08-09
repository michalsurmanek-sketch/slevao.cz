(() => {
  'use strict';

  function itemForButton(button) {
    const card = button?.closest('.allLeafletCard');
    const index = Number(card?.dataset?.leafletIndex);
    if (!Number.isInteger(index)) return null;
    return (window.__slevaoAllLeaflets || [])[index] || null;
  }

  function viewerUrl(item) {
    const params = new URLSearchParams({
      src: String(item.preview_url || ''),
      store: String(item.store_name || 'Obchod'),
      title: String(item.title || 'Aktuální leták'),
    });
    return `letak-viewer.html?${params.toString()}`;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-leaflet]');
    if (!button) return;
    const item = itemForButton(button);
    if (!item?.preview_url) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const target = viewerUrl(item);
    const opened = window.open(target, '_blank', 'noopener');
    if (!opened) window.location.href = target;
  }, true);
})();
