(() => {
  'use strict';

  const STALE_MS = 5 * 60 * 1000;
  let staleTimer = 0;
  let attachTimer = 0;
  let resultObserver = null;
  let lastRouteNode = null;

  function clearStaleTimer() {
    if (!staleTimer) return;
    window.clearTimeout(staleTimer);
    staleTimer = 0;
  }

  function removeWarning(results) {
    results?.querySelector('#srRouteFreshness')?.remove();
  }

  function markStale(results, routeNode) {
    staleTimer = 0;
    if (!routeNode || results.querySelector('.srRouteResults') !== routeNode) return;
    if (results.querySelector('#srRouteFreshness')) return;
    const warning = document.createElement('div');
    warning.id = 'srRouteFreshness';
    warning.className = 'srRouteFreshness';
    warning.setAttribute('role', 'status');
    warning.textContent = 'Ceny v této trase jsou starší než 5 minut. Pro aktuální ceny použij znovu „Spočítat nejlepší trasu“.';
    results.appendChild(warning);
  }

  function sync(results) {
    const routeNode = results.querySelector('.srRouteResults');
    if (!routeNode) {
      clearStaleTimer();
      removeWarning(results);
      lastRouteNode = null;
      return;
    }
    if (routeNode === lastRouteNode) return;

    lastRouteNode = routeNode;
    clearStaleTimer();
    removeWarning(results);
    staleTimer = window.setTimeout(() => markStale(results, routeNode), STALE_MS);
  }

  function attach() {
    const results = document.getElementById('srResults');
    if (!results) return false;
    resultObserver = new MutationObserver(() => sync(results));
    resultObserver.observe(results, { childList:true });
    sync(results);
    return true;
  }

  if (!attach()) {
    let attempts = 0;
    attachTimer = window.setInterval(() => {
      attempts += 1;
      if (attach() || attempts >= 60) {
        window.clearInterval(attachTimer);
        attachTimer = 0;
      }
    }, 100);
  }

  window.addEventListener('beforeunload', () => {
    clearStaleTimer();
    if (attachTimer) window.clearInterval(attachTimer);
    resultObserver?.disconnect();
  }, { once:true });
})();
