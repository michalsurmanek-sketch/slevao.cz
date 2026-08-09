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
      if (!item.logo_url) item.logo_url = GLOBUS_LOGO;
    });
  }

  function logoImg(extra = '') {
    return `<img src="${GLOBUS_LOGO}" alt="" ${extra}>`;
  }

  function patchSuggestions() {
    document.querySelectorAll('.leafletsStoreSuggestion[data-store-slug="globus"] .leafletsStoreSuggestionLogo').forEach((box) => {
      const img = box.querySelector('img');
      if (!img || !img.getAttribute('src')) box.innerHTML = logoImg('loading="lazy" decoding="async"');
    });

    if (lead && input && String(input.value || '').trim().toLowerCase() === 'globus') {
      const img = lead.querySelector('img');
      if (!img || !img.getAttribute('src')) lead.innerHTML = logoImg('aria-hidden="true"');
    }
  }

  function patchCards() {
    const allItems = items();
    document.querySelectorAll('.allLeafletCard[data-leaflet-index]').forEach((card) => {
      const index = Number(card.dataset.leafletIndex);
      const item = Number.isInteger(index) ? allItems[index] : null;
      if (String(item?.store_slug || '').toLowerCase() !== 'globus') return;

      const store = card.querySelector('.allLeafletStore');
      if (store && !store.querySelector('img')) {
        const mark = store.querySelector('.allLeafletStoreMark');
        if (mark) mark.outerHTML = `<img src="${GLOBUS_LOGO}" alt="Logo Globus" loading="lazy" decoding="async">`;
      }

      const placeholder = card.querySelector('.allLeafletCoverPlaceholder');
      if (placeholder && !placeholder.querySelector('img')) {
        const visual = placeholder.querySelector('span');
        if (visual) visual.outerHTML = logoImg('aria-hidden="true"');
      }
    });
  }

  function patchAll() {
    patchData();
    patchSuggestions();
    patchCards();
  }

  const observer = new MutationObserver(patchAll);
  if (suggestions) observer.observe(suggestions, { childList: true, subtree: true });
  if (categories) observer.observe(categories, { childList: true, subtree: true });

  patchAll();
  [80, 250, 700, 1500].forEach((delay) => window.setTimeout(patchAll, delay));
})();
