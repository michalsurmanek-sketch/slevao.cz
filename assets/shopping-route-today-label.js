(() => {
  'use strict';

  function formatDateKey(dateKey) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    return new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric' })
      .format(new Date(Date.UTC(year, month - 1, day)));
  }

  function sync() {
    const api = window.SlevaoLocation;
    const badge = document.querySelector('#srResults .srResultBadge');
    if (!api || !badge) return false;
    const date = formatDateKey(api.TODAY);
    const label = date ? `Dnešní trasa · ${date}` : 'Dnešní trasa';
    if (badge.textContent !== label) badge.textContent = label;
    badge.dataset.routeDate = String(api.TODAY || '');
    return true;
  }

  function init() {
    const results = document.getElementById('srResults');
    if (!results) return;
    sync();
    new MutationObserver(sync).observe(results, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();

  window.SlevaoShoppingRouteTodayLabel = { formatDateKey, sync };
})();
