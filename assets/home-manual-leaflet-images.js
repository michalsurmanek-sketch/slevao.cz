(() => {
  'use strict';
  if (document.querySelector('script[data-slevao-leaflet-control]')) return;
  const script = document.createElement('script');
  script.src = `assets/home-leaflet-control.js?v=20260802-1-${Date.now()}`;
  script.defer = true;
  script.dataset.slevaoLeafletControl = 'true';
  document.head.append(script);
})();
