(() => {
  'use strict';

  const ONLINE_OFFERS = {
    ikea: 'https://www.ikea.com/cz/cs/cat/lower-price/',
  };

  function itemForCard(card) {
    const index = Number(card?.dataset?.leafletIndex);
    if (!Number.isInteger(index)) return null;
    return (window.__slevaoAllLeaflets || [])[index] || null;
  }

  function decorateOnlineOffer(card) {
    if (!card || card.dataset.onlineOfferFixed === '1') return;
    const item = itemForCard(card);
    const slug = String(item?.store_slug || '').toLowerCase();
    const target = ONLINE_OFFERS[slug];
    if (!target) return;

    card.dataset.onlineOfferFixed = '1';
    card.dataset.coverLoaded = '1';
    card.dataset.onlineOfferUrl = target;

    const badge = card.querySelector('.allLeafletBadge');
    if (badge) badge.textContent = 'Aktuální nabídka';

    const title = card.querySelector('.allLeafletBody h3');
    if (title && /let[aá]k/i.test(title.textContent || '')) title.textContent = 'Snižujeme ceny, kde se dá';

    const hint = card.querySelector('.allLeafletCoverPlaceholder small');
    if (hint) hint.textContent = 'Oficiální nabídka IKEA';

    const button = card.querySelector('[data-open-leaflet]');
    if (button) {
      button.textContent = 'Otevřít nabídku ↗';
      button.setAttribute('aria-label', 'Otevřít aktuální nabídku IKEA');
    }
  }

  function decorateAll() {
    document.querySelectorAll('.allLeafletCard').forEach(decorateOnlineOffer);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-leaflet]');
    if (!button) return;
    const card = button.closest('.allLeafletCard');
    const item = itemForCard(card);
    const target = ONLINE_OFFERS[String(item?.store_slug || '').toLowerCase()];
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = target;
  }, true);

  const observer = new MutationObserver(decorateAll);

  function start() {
    decorateAll();
    const root = document.getElementById('leafletCategories');
    if (root) observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
