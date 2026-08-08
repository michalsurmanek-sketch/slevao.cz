(() => {
  'use strict';

  if (!document.querySelector('link[href*="public-features.css"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'assets/public-features.css?v=20260804-2';
    document.head.appendChild(style);
  }
  if (!document.querySelector('script[src*="public-features.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/public-features.js?v=20260804-2';
    script.defer = true;
    document.head.appendChild(script);
  }
  if (!document.querySelector('script[src*="public-nav-upgrade.js"]')) {
    const navScript = document.createElement('script');
    navScript.src = 'assets/public-nav-upgrade.js?v=20260804-4';
    navScript.defer = true;
    document.head.appendChild(navScript);
  }
  if (!document.querySelector('link[href*="home-quick-food-filter.css"]')) {
    const quickFoodStyle = document.createElement('link');
    quickFoodStyle.rel = 'stylesheet';
    quickFoodStyle.href = 'assets/home-quick-food-filter.css?v=20260808-7';
    document.head.appendChild(quickFoodStyle);
  }
  if (!document.querySelector('script[src*="home-quick-food-filter.js"]')) {
    const quickFoodScript = document.createElement('script');
    quickFoodScript.src = 'assets/home-quick-food-filter.js?v=20260808-2';
    quickFoodScript.defer = true;
    document.head.appendChild(quickFoodScript);
  }
  if (!document.querySelector('link[href*="home-autopilot.css"]')) {
    const autopilotStyle = document.createElement('link');
    autopilotStyle.rel = 'stylesheet';
    autopilotStyle.href = 'assets/home-autopilot.css?v=20260808-1';
    document.head.appendChild(autopilotStyle);
  }
  if (!document.querySelector('script[src*="home-autopilot.js"]')) {
    const autopilotScript = document.createElement('script');
    autopilotScript.src = 'assets/home-autopilot.js?v=20260807-1';
    autopilotScript.defer = true;
    document.head.appendChild(autopilotScript);
  }
  if (!document.querySelector('link[href*="home-save-today.css"]')) {
    const saveTodayStyle = document.createElement('link');
    saveTodayStyle.rel = 'stylesheet';
    saveTodayStyle.href = 'assets/home-save-today.css?v=20260807-4';
    document.head.appendChild(saveTodayStyle);
  }
  if (!document.querySelector('script[src*="home-save-today.js"]')) {
    const saveTodayScript = document.createElement('script');
    saveTodayScript.src = 'assets/home-save-today.js?v=20260807-3';
    saveTodayScript.defer = true;
    document.head.appendChild(saveTodayScript);
  }
  if (!document.querySelector('script[src*="home-save-text-helper.js"]')) {
    const saveTextHelper = document.createElement('script');
    saveTextHelper.src = 'assets/home-save-text-helper.js?v=20260807-1';
    saveTextHelper.defer = true;
    document.head.appendChild(saveTextHelper);
  }
  if (!document.querySelector('script[src*="location-service.js"]')) {
    const locationScript = document.createElement('script');
    locationScript.src = 'assets/location-service.js?v=20260807-3';
    locationScript.defer = true;
    document.head.appendChild(locationScript);
  }
  if (!document.querySelector('link[href*="home-live.css"]')) {
    const liveStyle = document.createElement('link');
    liveStyle.rel = 'stylesheet';
    liveStyle.href = 'assets/home-live.css?v=20260808-2';
    document.head.appendChild(liveStyle);
  }
  if (!document.querySelector('link[href*="home-live-hero.css"]')) {
    const liveHeroStyle = document.createElement('link');
    liveHeroStyle.rel = 'stylesheet';
    liveHeroStyle.href = 'assets/home-live-hero.css?v=20260808-4';
    document.head.appendChild(liveHeroStyle);
  }
  if (!document.querySelector('script[src*="home-live.js"]')) {
    const liveScript = document.createElement('script');
    liveScript.src = 'assets/home-live.js?v=20260808-2';
    liveScript.defer = true;
    document.head.appendChild(liveScript);
  }
  if (!document.querySelector('link[href*="home-in-store.css"]')) {
    const inStoreStyle = document.createElement('link');
    inStoreStyle.rel = 'stylesheet';
    inStoreStyle.href = 'assets/home-in-store.css?v=20260807-2';
    document.head.appendChild(inStoreStyle);
  }
  if (!document.querySelector('script[src*="home-in-store.js"]')) {
    const inStoreScript = document.createElement('script');
    inStoreScript.src = 'assets/home-in-store.js?v=20260807-1';
    inStoreScript.defer = true;
    document.head.appendChild(inStoreScript);
  }
  if (!document.querySelector('script[src*="home-in-store-safe.js"]')) {
    const inStoreSafeScript = document.createElement('script');
    inStoreSafeScript.src = 'assets/home-in-store-safe.js?v=20260807-2';
    inStoreSafeScript.defer = true;
    document.head.appendChild(inStoreSafeScript);
  }
  if (!document.querySelector('script[src*="home-in-store-equivalence.js"]')) {
    const inStoreEquivalenceScript = document.createElement('script');
    inStoreEquivalenceScript.src = 'assets/home-in-store-equivalence.js?v=20260807-1';
    inStoreEquivalenceScript.defer = true;
    document.head.appendChild(inStoreEquivalenceScript);
  }
  if (!document.querySelector('link[href*="home-in-store-actions.css"]')) {
    const inStoreActionsStyle = document.createElement('link');
    inStoreActionsStyle.rel = 'stylesheet';
    inStoreActionsStyle.href = 'assets/home-in-store-actions.css?v=20260807-1';
    document.head.appendChild(inStoreActionsStyle);
  }
  if (!document.querySelector('script[src*="home-in-store-actions.js"]')) {
    const inStoreActionsScript = document.createElement('script');
    inStoreActionsScript.src = 'assets/home-in-store-actions.js?v=20260807-1';
    inStoreActionsScript.defer = true;
    document.head.appendChild(inStoreActionsScript);
  }
  if (!document.querySelector('link[href*="home-in-store-list.css"]')) {
    const inStoreListStyle = document.createElement('link');
    inStoreListStyle.rel = 'stylesheet';
    inStoreListStyle.href = 'assets/home-in-store-list.css?v=20260807-1';
    document.head.appendChild(inStoreListStyle);
  }
  if (!document.querySelector('script[src*="home-in-store-list.js"]')) {
    const inStoreListScript = document.createElement('script');
    inStoreListScript.src = 'assets/home-in-store-list.js?v=20260807-1';
    inStoreListScript.defer = true;
    document.head.appendChild(inStoreListScript);
  }

  const hideInStore = () => {
    const node = document.getElementById('slInStore');
    if (!node) return;
    node.hidden = true;
    node.innerHTML = '';
  };
  document.addEventListener('submit', (event) => {
    if (event.target?.id === 'slLiveManual') hideInStore();
  });
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'slLiveRadius') hideInStore();
  });

  const form = document.getElementById('footerAlertsForm');
  const input = document.getElementById('footerAlertEmail');
  const status = document.getElementById('footerAlertStatus');
  if (!form || !input || !status) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!email || !input.checkValidity()) {
      status.textContent = 'Zadej platnou e-mailovou adresu.';
      input.focus();
      return;
    }

    localStorage.setItem('slevao-account-email', email);
    status.textContent = 'Pokračuj do účtu a nastav konkrétní produkty i cílové ceny.';
    window.setTimeout(() => {
      window.location.href = `ucet.html?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(location.href)}`;
    }, 500);
  });
})();
