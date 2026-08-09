(() => {
  'use strict';

  const GLOBUS_LOGO = 'assets/logos/globus.svg?v=1';
  const suggestions = document.getElementById('leafletsStoreSuggestions');
  const categories = document.getElementById('leafletCategories');
  const input = document.getElementById('leafletsStoreSearchInput');
  const lead = document.getElementById('leafletsStoreSearchLead');

  function items() {
    return Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
  }

  function patchData() {
    items().forEach((item) => {
      if (String(item?.store_slug || '').toLowerCase() !== 'globus') return;
      item.logo_url = GLOBUS_LOGO;
      item.category = 'food';
    });
  }

  function ensureLogo(slot, alt = '') {
    if (!slot) return;
    let img = slot.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = alt;
      slot.replaceChildren(img);
    }
    if (img.getAttribute('src') !== GLOBUS_LOGO) img.setAttribute('src', GLOBUS_LOGO);
  }

  function patchSuggestions() {
    document.querySelectorAll('.leafletsStoreSuggestion[data-store-slug="globus"] .leafletsStoreSuggestionLogo').forEach((slot) => {
      ensureLogo(slot);
    });

    if (lead && input && String(input.value || '').trim().toLowerCase() === 'globus') {
      ensureLogo(lead);
      lead.querySelector('img')?.setAttribute('aria-hidden', 'true');
    }
  }

  function patchCards() {
    const allItems = items();
    document.querySelectorAll('.allLeafletCard[data-leaflet-index]').forEach((card) => {
      const index = Number(card.dataset.leafletIndex);
      const item = Number.isInteger(index) ? allItems[index] : null;
      if (String(item?.store_slug || '').toLowerCase() !== 'globus') return;

      const store = card.querySelector('.allLeafletStore');
      if (store) {
        let img = store.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = 'Logo Globus';
          img.loading = 'lazy';
          img.decoding = 'async';
          store.prepend(img);
          store.querySelector('.allLeafletStoreMark')?.remove();
        }
        if (img.getAttribute('src') !== GLOBUS_LOGO) img.setAttribute('src', GLOBUS_LOGO);
      }

      const placeholder = card.querySelector('.allLeafletCoverPlaceholder');
      if (placeholder) {
        let img = placeholder.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          img.setAttribute('aria-hidden', 'true');
          placeholder.prepend(img);
        }
        if (img.getAttribute('src') !== GLOBUS_LOGO) img.setAttribute('src', GLOBUS_LOGO);
      }
    });
  }

  function patchAll() {
    patchData();
    patchSuggestions();
    patchCards();
  }

  let queued = false;
  function queuePatch() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      patchAll();
    });
  }

  const observer = new MutationObserver(queuePatch);
  if (suggestions) observer.observe(suggestions, { childList: true, subtree: true });
  if (categories) observer.observe(categories, { childList: true, subtree: true });

  patchAll();
  [80, 250, 700, 1500].forEach((delay) => window.setTimeout(patchAll, delay));
})();
