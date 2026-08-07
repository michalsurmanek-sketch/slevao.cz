(() => {
  'use strict';

  const BRIEF_KEY = 'slevao-savings-brief-v1';

  function readBrief() {
    try {
      const value = JSON.parse(localStorage.getItem(BRIEF_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function requested() {
    return new URLSearchParams(location.search).get('route') === '1';
  }

  function applyPlannerSettings() {
    const brief = readBrief();
    if (!brief) return;
    const maxStores = document.getElementById('srMaxStores');
    const radius = document.getElementById('srRadius');
    if (maxStores && [1, 2, 3].includes(Number(brief.max_stores))) maxStores.value = String(Number(brief.max_stores));
    if (radius && [5, 10, 15, 25, 40].includes(Number(brief.radius_km))) radius.value = String(Number(brief.radius_km));
  }

  function run() {
    if (!requested()) return true;
    const button = document.getElementById('srCalculate');
    const status = document.getElementById('srStatus');
    if (!button) return false;
    applyPlannerSettings();
    if (button.disabled) return true;
    if (status) status.textContent = 'Navazuji na doporučený nákup a připravuji GPS trasu…';
    window.setTimeout(() => button.click(), 180);
    return true;
  }

  function init() {
    if (!requested()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts++;
      if (run() || attempts >= 80) window.clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
