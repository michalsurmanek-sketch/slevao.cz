(() => {
  'use strict';

  if (!document.querySelector('link[href*="public-features.css"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'assets/public-features.css?v=20260804-1';
    document.head.appendChild(style);
  }
  if (!document.querySelector('script[src*="public-features.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/public-features.js?v=20260804-1';
    script.defer = true;
    document.head.appendChild(script);
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
