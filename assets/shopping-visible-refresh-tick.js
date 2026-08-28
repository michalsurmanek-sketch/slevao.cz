(() => {
  'use strict';

  const TICK_MS = 5 * 60 * 1000;

  function pulse() {
    if (document.hidden) return;
    window.dispatchEvent(new Event('focus'));
  }

  const timer = window.setInterval(pulse, TICK_MS);
  window.addEventListener('beforeunload', () => window.clearInterval(timer), { once:true });
})();
