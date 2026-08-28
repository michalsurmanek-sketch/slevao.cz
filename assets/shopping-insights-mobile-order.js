(() => {
  'use strict';

  const layout = document.querySelector('.sfListLayout');
  if (!layout?.parentElement) return;

  const parent = layout.parentElement;
  const mobile = window.matchMedia('(max-width: 720px)');
  let queued = false;

  function sync() {
    queued = false;
    const insights = document.getElementById('shoppingInsights');
    if (!insights || insights.parentElement !== parent) return;

    if (mobile.matches) {
      if (layout.nextElementSibling !== insights) layout.insertAdjacentElement('afterend', insights);
      return;
    }

    if (layout.previousElementSibling !== insights) parent.insertBefore(insights, layout);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  new MutationObserver(schedule).observe(parent, { childList:true });
  if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', schedule);
  schedule();
})();
