(() => {
  'use strict';

  const ONLINE_OFFERS = {
    ikea: {
      url: 'https://www.ikea.com/cz/cs/cat/lower-price/',
      title: 'Snižujeme ceny, kde se dá',
      aria: 'Otevřít aktuální nabídku IKEA',
    },
    kaufland: {
      url: 'https://prodejny.kaufland.cz/nabidka/prehled.html',
      title: 'Aktuální nabídka: zboží v akci',
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
    const offer = ONLINE_OFFERS[slug];
    return offer ? { ...offer, slug, item } : null;
  }

  function buildOnlineCover(card, offer) {
    const cover = card.querySelector('.allLeafletCover');
    if (!cover || cover.querySelector('.allLeafletOnlineVisual')) return;

    const sourceLogo = card.querySelector('.allLeafletStore img') || cover.querySelector('.allLeafletCoverPlaceholder img');
    const storeName = String(offer.item?.store_name || offer.slug || '').trim();

    const visual = document.createElement('div');
    visual.className = 'allLeafletOnlineVisual';
    visual.setAttribute('aria-hidden', 'true');

    const sheet = document.createElement('div');
    sheet.className = 'allLeafletOnlineSheet';

    const brand = document.createElement('div');
    brand.className = 'allLeafletOnlineBrand';
    if (sourceLogo) {
      const logo = sourceLogo.cloneNode(true);
      logo.removeAttribute('loading');
      logo.removeAttribute('decoding');
      logo.alt = '';
      brand.appendChild(logo);
    } else {
      const name = document.createElement('strong');
      name.textContent = storeName;
      brand.appendChild(name);
    }

    const stripe = document.createElement('div');
    stripe.className = 'allLeafletOnlineStripe';
    stripe.innerHTML = '<span>AKTUÁLNÍ</span><strong>NABÍDKA</strong>';

    const detail = document.createElement('div');
    detail.className = 'allLeafletOnlineDetail';
    detail.innerHTML = '<i></i><i></i><i></i><b>%</b>';

    sheet.append(brand, stripe, detail);
    visual.appendChild(sheet);

    cover.querySelector('.allLeafletCoverPlaceholder')?.remove();
    cover.prepend(visual);
  }

  function decorateOnlineOffer(card) {
    if (!card || card.dataset.onlineOfferFixed === '1') return;
    const offer = offerForCard(card);
    if (!offer) return;

    card.dataset.onlineOfferFixed = '1';
    card.dataset.coverLoaded = '1';
    card.dataset.onlineOfferUrl = offer.url;
    card.dataset.onlineStore = offer.slug;
    card.classList.add('allLeafletCard--online');

    buildOnlineCover(card, offer);

    const badge = card.querySelector('.allLeafletBadge');
    if (badge) badge.textContent = 'Aktuální nabídka';

    const title = card.querySelector('.allLeafletBody h3');
    if (title) title.textContent = offer.title;

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
