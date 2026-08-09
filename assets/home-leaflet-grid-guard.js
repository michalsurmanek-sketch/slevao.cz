(() => {
  'use strict';

  const grid = document.getElementById('leafletGrid');
  if (!grid || grid.dataset.leafletGridGuard === '1') return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.get || !descriptor?.set) return;

  window.__slevaoDedicatedLeafletGrid = true;
  grid.dataset.leafletGridGuard = '1';

  Object.defineProperty(grid, 'innerHTML', {
    configurable: true,
    enumerable: false,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      const html = String(value ?? '');
      const dedicatedWrite =
        html.includes('data-direct-leaflet-card="1"') ||
        html.includes('data-fast-skeleton=') ||
        html.includes('leafletFastSkeleton');

      if (window.__slevaoDedicatedLeafletGrid && !dedicatedWrite) return;
      descriptor.set.call(this, value);
    },
  });
})();