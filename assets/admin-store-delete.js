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

  if (!document.querySelector('script[data-homepage-image-nav]')) {
    const navScript = document.createElement('script');
    navScript.src = `assets/admin-homepage-image-nav.js?v=20260802-1-${Date.now()}`;
    navScript.async = false;
    navScript.dataset.homepageImageNav = 'true';
    document.head.append(navScript);
  }
})();
