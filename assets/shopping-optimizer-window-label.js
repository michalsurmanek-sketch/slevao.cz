(() => {
  'use strict';

  const optimizer = document.getElementById('optimizer');
  if (!optimizer) return;

  const PREFIX = '7denní odhad · ';
  const NOTE = 'Orientační varianta: jednotlivé budoucí ceny nemusí platit ve stejný den.';

  function isUpcomingEstimate(text) {
    const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return normalized.includes('pouziva akci zacinajici');
  }

  function syncCard(card) {
    if (card?.dataset?.dayConsistentPlan === 'true') return;
    const heading = card?.querySelector?.('h3');
    const description = card?.querySelector?.('.sfMuted');
    if (!heading || !description) return;

    const upcoming = isUpcomingEstimate(description.textContent);
    card.dataset.windowEstimate = upcoming ? 'true' : 'false';

    const currentHeading = String(heading.textContent || '');
    const baseHeading = currentHeading.startsWith(PREFIX) ? currentHeading.slice(PREFIX.length) : currentHeading;
    const desiredHeading = upcoming ? `${PREFIX}${baseHeading}` : baseHeading;
    if (currentHeading !== desiredHeading) heading.textContent = desiredHeading;

    const currentDescription = String(description.textContent || '').trim();
    if (upcoming) {
      if (!currentDescription.includes(NOTE)) description.textContent = `${currentDescription} ${NOTE}`.trim();
    } else if (currentDescription.includes(NOTE)) {
      description.textContent = currentDescription.replace(NOTE, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  function sync() {
    optimizer.querySelectorAll('.sfResultBox').forEach(syncCard);
  }

  sync();
  new MutationObserver(sync).observe(optimizer, { childList:true, subtree:true });
  window.SlevaoShoppingOptimizerWindowLabel = { isUpcomingEstimate, sync };
})();
