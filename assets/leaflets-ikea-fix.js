(() => {
  'use strict';

  const ONLINE_OFFERS = {
    ikea: {
      url: 'https://www.ikea.com/cz/cs/cat/lower-price/',
      title: 'Snižujeme ceny, kde se dá',
      hint: 'Oficiální nabídka IKEA',
      aria: 'Otevřít aktuální nabídku IKEA',
    },
    kaufland: {
      url: 'https://prodejny.kaufland.cz/nabidka/prehled.html',
      title: 'Aktuální nabídka: zboží v akci',
      hint: 'Oficiální nabídka Kaufland',
      aria: 'Otevřít aktuální nabídku Kaufland',
    },
  };

  function itemForCard(card) {
    const index = Number(card?.dataset?.leafletIndex);
    if (!Number.isInteger(index)) return null;
    return (window.__slevaoAllLeaflets || [])[index] || null;
  }

  function offerForCard(card) {
    const item = itemForCard(card);
    const slug = String(item?.store_slug || '').toLowerCase();
    return ONLINE_OFFERS[slug] || null;
  }

  function decorateOnlineOffer(card) {
    if (!card || card.dataset.onlineOfferFixed === '1') return;
    const offer = offerForCard(card);
    if (!offer) return;

    card.dataset.onlineOfferFixed = '1';
    card.dataset.coverLoaded = '1';
    card.dataset.onlineOfferUrl = offer.url;

    const badge = card.querySelector('.allLeafletBadge');
    if (badge) badge.textContent = 'Aktuální nabídka';

    const title = card.querySelector('.allLeafletBody h3');
    if (title) title.textContent = offer.title;

    const hint = card.querySelector('.allLeafletCoverPlaceholder small');
    if (hint) hint.textContent = offer.hint;

    const button = card.querySelector('[data-open-leaflet]');
    if (button) {
      button.textContent = 'Otevřít nabídku ↗';
      button.setAttribute('aria-label', offer.aria);
    }
  }

  function decorateAll() {
    document.querySelectorAll('.allLeafletCard').forEach(decorateOnlineOffer);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-leaflet]');
    if (!button) return;
    const card = button.closest('.allLeafletCard');
    const offer = offerForCard(card);
    if (!offer) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const opened = window.open(offer.url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = offer.url;
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
