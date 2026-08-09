(() => {
  'use strict';

  const LOGO = 'assets/logos/brnenka.svg?v=1';
  const SLUG = 'brnenka';
  const input = document.getElementById('leafletsStoreSearchInput');
  const suggestions = document.getElementById('leafletsStoreSuggestions');
  const categories = document.getElementById('leafletCategories');
  if (!input || !suggestions || !categories) return;

  function patchItems() {
    const items = Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
    let count = 0;
    let name = 'Brněnka';

    items.forEach((item) => {
      if (String(item?.store_slug || '').toLowerCase() !== SLUG) return;
      item.logo_url = LOGO;
      item.category = 'food';
      name = String(item.store_name || name);
      count += 1;
    });

    return { count, name };
  }

  function fixRenderedCards() {
    const items = Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
    document.querySelectorAll('.allLeafletCard[data-leaflet-index]').forEach((card) => {
      const index = Number(card.dataset.leafletIndex);
      const item = Number.isInteger(index) ? items[index] : null;
      if (String(item?.store_slug || '').toLowerCase() !== SLUG) return;

      const store = card.querySelector('.allLeafletStore');
      if (store) {
        let image = store.querySelector('img');
        if (!image) {
          image = document.createElement('img');
          image.alt = 'Logo Brněnka';
          image.loading = 'lazy';
          image.decoding = 'async';
          store.prepend(image);
        }
        image.src = LOGO;
        store.querySelector('.allLeafletStoreMark')?.remove();
      }

      const placeholder = card.querySelector('.allLeafletCoverPlaceholder');
      if (placeholder && !placeholder.querySelector('img')) {
        const image = document.createElement('img');
        image.src = LOGO;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        placeholder.prepend(image);
      }
    });
  }

  function fixSuggestionLogo() {
    const button = suggestions.querySelector('[data-store-slug="brnenka"]');
    if (!button) return;
    const slot = button.querySelector('.leafletsStoreSuggestionLogo');
    if (slot) slot.innerHTML = `<img src="${LOGO}" alt="" loading="lazy" decoding="async">`;
    const category = button.querySelector('.leafletsStoreSuggestionText small');
    if (category) category.textContent = 'Potraviny';
  }

  function appendToDefaultSuggestions() {
    if (input.value.trim() || suggestions.hidden || suggestions.querySelector('[data-store-slug="brnenka"]')) return;
    const { count, name } = patchItems();
    if (!count) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'leafletsStoreSuggestion';
    button.dataset.storeSlug = SLUG;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = `
      <span class="leafletsStoreSuggestionLogo"><img src="${LOGO}" alt="" loading="lazy" decoding="async"></span>
      <span class="leafletsStoreSuggestionText"><strong>${name}</strong><small>Potraviny</small></span>
      <span class="leafletsStoreSuggestionCount">${count} ${count === 1 ? 'leták' : count < 5 ? 'letáky' : 'letáků'}</span>`;
    suggestions.append(button);
  }

  function refresh() {
    patchItems();
    fixRenderedCards();
    fixSuggestionLogo();
    appendToDefaultSuggestions();
  }

  function schedule() {
    [0, 120, 300, 700].forEach((delay) => window.setTimeout(refresh, delay));
  }

  input.addEventListener('focus', schedule);
  input.addEventListener('click', schedule);
  input.addEventListener('input', schedule);

  const observer = new MutationObserver(schedule);
  observer.observe(categories, { childList: true, subtree: true });

  schedule();
})();
