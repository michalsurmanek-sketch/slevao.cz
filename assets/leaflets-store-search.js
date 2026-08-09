(() => {
  'use strict';

  const root = document.getElementById('leafletsStoreSearch');
  const input = document.getElementById('leafletsStoreSearchInput');
  const suggestions = document.getElementById('leafletsStoreSuggestions');
  const lead = document.getElementById('leafletsStoreSearchLead');
  const clearButton = document.getElementById('leafletsStoreSearchClear');
  const searchButton = document.getElementById('leafletsStoreSearchButton');
  const categoriesRoot = document.getElementById('leafletCategories');
  if (!root || !input || !suggestions || !lead || !clearButton || !searchButton) return;

  const CATEGORY_NAMES = {
    food: 'Potraviny',
    drugstore: 'Drogerie',
    home: 'Dům, dílna a zahrada',
    electronics: 'Elektronika',
    fashion: 'Móda a sport',
    pharmacy: 'Lékárny',
    pets: 'Chovatelské potřeby',
    auto: 'Auto',
    other: 'Ostatní',
  };

  let activeIndex = -1;
  let visibleStores = [];
  let selectedSlug = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  }[character]));

  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function currentStores() {
    const items = Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
    const bySlug = new Map();
    items.forEach((item, index) => {
      const slug = String(item?.store_slug || '').toLowerCase();
      if (!slug) return;
      if (!bySlug.has(slug)) {
        bySlug.set(slug, {
          slug,
          name: String(item.store_name || slug),
          logo: item.logo_url || '',
          category: item.category || 'other',
          count: 0,
          firstIndex: index,
        });
      }
      const store = bySlug.get(slug);
      store.count += 1;
      if (!store.logo && item.logo_url) store.logo = item.logo_url;
    });
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  }

  function searchIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.7-3.7"></path></svg>';
  }

  function setLead(store = null) {
    if (store?.logo) {
      lead.innerHTML = `<img src="${esc(store.logo)}" alt="" aria-hidden="true">`;
      return;
    }
    if (store) {
      lead.innerHTML = `<span class="leafletsStoreSuggestionMark" aria-hidden="true">%</span>`;
      return;
    }
    lead.innerHTML = searchIcon();
  }

  function resultMarkup(store, index) {
    const logo = store.logo
      ? `<img src="${esc(store.logo)}" alt="" loading="lazy" decoding="async">`
      : '<span class="leafletsStoreSuggestionMark" aria-hidden="true">%</span>';
    const category = CATEGORY_NAMES[store.category] || 'Aktuální letáky';
    return `<button type="button" class="leafletsStoreSuggestion${index === activeIndex ? ' is-active' : ''}" data-store-index="${index}" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}">
      <span class="leafletsStoreSuggestionLogo">${logo}</span>
      <span class="leafletsStoreSuggestionText"><strong>${esc(store.name)}</strong><small>${esc(category)}</small></span>
      <span class="leafletsStoreSuggestionCount">${store.count} ${store.count === 1 ? 'leták' : store.count < 5 ? 'letáky' : 'letáků'}</span>
    </button>`;
  }

  function renderSuggestions(forceAll = false) {
    const query = fold(input.value);
    const stores = currentStores();
    let results = stores;

    if (query && !forceAll) {
      results = stores
        .map((store) => {
          const name = fold(store.name);
          const slug = fold(store.slug.replace(/-/g, ' '));
          let score = 9;
          if (name === query || slug === query) score = 0;
          else if (name.startsWith(query)) score = 1;
          else if (slug.startsWith(query)) score = 2;
          else if (name.includes(query)) score = 3;
          else if (slug.includes(query)) score = 4;
          return { store, score };
        })
        .filter((entry) => entry.score < 9)
        .sort((a, b) => a.score - b.score || a.store.name.localeCompare(b.store.name, 'cs'))
        .map((entry) => entry.store);
    }

    visibleStores = results.slice(0, 8);
    activeIndex = visibleStores.length ? Math.min(Math.max(activeIndex, 0), visibleStores.length - 1) : -1;

    if (!stores.length) {
      suggestions.innerHTML = '<div class="leafletsStoreNoResult">Načítám aktuální obchody…</div>';
    } else if (!visibleStores.length) {
      suggestions.innerHTML = '<div class="leafletsStoreNoResult">Takový obchod mezi aktuálními letáky není.</div>';
    } else {
      suggestions.innerHTML = visibleStores.map(resultMarkup).join('');
    }
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeSuggestions() {
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function findCard(store) {
    const items = Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
    const index = items.findIndex((item) => String(item?.store_slug || '').toLowerCase() === store.slug);
    if (index < 0) return null;
    return document.querySelector(`.allLeafletCard[data-leaflet-index="${index}"]`);
  }

  function revealStore(store) {
    if (!store) return;
    selectedSlug = store.slug;
    input.value = store.name;
    clearButton.hidden = false;
    setLead(store);
    closeSuggestions();

    const reveal = () => {
      const card = findCard(store);
      if (!card) return false;
      document.querySelectorAll('.allLeafletCard--search-hit').forEach((node) => node.classList.remove('allLeafletCard--search-hit'));
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('allLeafletCard--search-hit');
      window.setTimeout(() => card.classList.remove('allLeafletCard--search-hit'), 1600);
      return true;
    };

    if (!reveal()) window.setTimeout(reveal, 350);
  }

  function chooseBest() {
    const query = fold(input.value);
    if (!query) {
      renderSuggestions(true);
      return;
    }
    const stores = currentStores();
    const exact = stores.find((store) => fold(store.name) === query || fold(store.slug.replace(/-/g, ' ')) === query);
    if (exact) {
      revealStore(exact);
      return;
    }
    renderSuggestions();
    if (visibleStores[0]) revealStore(visibleStores[0]);
  }

  input.addEventListener('focus', () => renderSuggestions(!input.value.trim()));
  input.addEventListener('input', () => {
    selectedSlug = '';
    setLead();
    clearButton.hidden = !input.value;
    activeIndex = 0;
    renderSuggestions();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestions.hidden) renderSuggestions(!input.value.trim());
      else {
        activeIndex = visibleStores.length ? (activeIndex + 1) % visibleStores.length : -1;
        suggestions.innerHTML = visibleStores.map(resultMarkup).join('');
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.hidden) renderSuggestions(!input.value.trim());
      else {
        activeIndex = visibleStores.length ? (activeIndex - 1 + visibleStores.length) % visibleStores.length : -1;
        suggestions.innerHTML = visibleStores.map(resultMarkup).join('');
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!suggestions.hidden && visibleStores[activeIndex]) revealStore(visibleStores[activeIndex]);
      else chooseBest();
    } else if (event.key === 'Escape') {
      closeSuggestions();
      input.blur();
    }
  });

  suggestions.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('[data-store-index]');
    if (!button) return;
    event.preventDefault();
    const index = Number(button.dataset.storeIndex);
    revealStore(visibleStores[index]);
  });

  searchButton.addEventListener('click', chooseBest);

  clearButton.addEventListener('click', () => {
    input.value = '';
    selectedSlug = '';
    clearButton.hidden = true;
    setLead();
    input.focus();
    renderSuggestions(true);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) closeSuggestions();
  });

  if (categoriesRoot) {
    const observer = new MutationObserver(() => {
      if (!suggestions.hidden) renderSuggestions(!input.value.trim());
      if (!selectedSlug) return;
      const store = currentStores().find((item) => item.slug === selectedSlug);
      if (store) setLead(store);
    });
    observer.observe(categoriesRoot, { childList: true, subtree: true });
  }

  setLead();
})();
