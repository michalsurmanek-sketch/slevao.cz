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
    quickFoodStyle.href = 'assets/home-quick-food-filter.css?v=20260807-1';
    document.head.appendChild(quickFoodStyle);
  }
  if (!document.querySelector('script[src*="home-quick-food-filter.js"]')) {
    const quickFoodScript = document.createElement('script');
    quickFoodScript.src = 'assets/home-quick-food-filter.js?v=20260807-1';
    quickFoodScript.defer = true;
    document.head.appendChild(quickFoodScript);
  }
  if (!document.querySelector('link[href*="home-autopilot.css"]')) {
    const autopilotStyle = document.createElement('link');
    autopilotStyle.rel = 'stylesheet';
    autopilotStyle.href = 'assets/home-autopilot.css?v=20260807-1';
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
    saveTodayStyle.href = 'assets/home-save-today.css?v=20260807-1';
    document.head.appendChild(saveTodayStyle);
  }
  if (!document.querySelector('script[src*="home-save-today.js"]')) {
    const saveTodayScript = document.createElement('script');
    saveTodayScript.src = 'assets/home-save-today.js?v=20260807-1';
    saveTodayScript.defer = true;
    document.head.appendChild(saveTodayScript);
  }

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
