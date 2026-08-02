(() => {
  'use strict';

  const script = document.createElement('script');
  script.src = `assets/admin-store-delete-hotfix.js?v=20260802-1-${Date.now()}`;
  script.async = false;
  script.dataset.adminStoreDeleteHotfix = 'true';
  script.onerror = () => {
    const message = document.getElementById('storeDeleteMessage');
    if (message) {
      message.textContent = 'Oprava mazání obchodů se nepodařila načíst. Obnov stránku přes Ctrl+F5.';
      message.className = 'storeDeleteMessage error';
    }
  };
  document.head.append(script);
})();
