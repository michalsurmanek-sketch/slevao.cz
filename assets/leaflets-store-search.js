(() => {
  'use strict';

  const root = document.getElementById('leafletsStoreSearch');
  const input = document.getElementById('leafletsStoreSearchInput');
  const suggestions = document.getElementById('leafletsStoreSuggestions');
  const lead = document.getElementById('leafletsStoreSearchLead');
  const clearButton = document.getElementById('leafletsStoreSearchClear');
  const searchButton = document.getElementById('leafletsStoreSearchButton');
  const categoriesRoot = document.getElementById('leafletCategories');
  if (!root || !input || !suggestions || !lead || !clearButton || !searchButton || !categoriesRoot) return;

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
  let selectionScrollTimer = 0;
  let focusScrollTimer = 0;

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

  function currentItems() {
    return Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
  }

  function currentStores() {
    const bySlug = new Map();
    currentItems().forEach((item) => {
      const slug = String(item?.store_slug || '').toLowerCase();
      if (!slug) return;
      if (!bySlug.has(slug)) {
        bySlug.set(slug, {
          slug,
          name: String(item.store_name || slug),
          logo: item.logo_url || '',
          category: item.category || 'other',
          count: 0,
        });
      }
      const store = bySlug.get(slug);
      store.count += 1;
      if (!store.logo && item.logo_url) store.logo = item.logo_url;
    });
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  }

  function storeBySlug(slug) {
    const normalized = String(slug || '').toLowerCase();
    return currentStores().find((store) => store.slug === normalized) || null;
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
      lead.innerHTML = '<span class="leafletsStoreSuggestionMark" aria-hidden="true">%</span>';
      return;
    }
    lead.innerHTML = searchIcon();
  }

  function resultMarkup(store, index) {
    const logo = store.logo
      ? `<img src="${esc(store.logo)}" alt="" loading="lazy" decoding="async">`
      : '<span class="leafletsStoreSuggestionMark" aria-hidden="true">%</span>';
    const category = CATEGORY_NAMES[store.category] || 'Aktuální letáky';
    return `<button type="button" class="leafletsStoreSuggestion${index === activeIndex ? ' is-active' : ''}" data-store-slug="${esc(store.slug)}" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}">
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
    if (!visibleStores.length) activeIndex = -1;
    else if (activeIndex < 0 || activeIndex >= visibleStores.length) activeIndex = 0;

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

  function restoreAllCards() {
    document.querySelectorAll('.allLeafletCard').forEach((card) => {
      card.style.removeProperty('display');
      card.classList.remove('allLeafletCard--search-hit');
    });
    document.querySelectorAll('.leafletCategorySection').forEach((section) => {
      section.style.removeProperty('display');
    });
  }

  function itemForCard(card) {
    const index = Number(card?.dataset?.leafletIndex);
    if (!Number.isInteger(index)) return null;
    return currentItems()[index] || null;
  }

  function applyStoreSelection(store, options = {}) {
    if (!store) return false;
    const { scroll = true, animate = true } = options;
    const cards = [...document.querySelectorAll('.allLeafletCard')];
    if (!cards.length) return false;

    let firstMatch = null;
    let matches = 0;
    cards.forEach((card) => {
      const item = itemForCard(card);
      const match = String(item?.store_slug || '').toLowerCase() === store.slug;
      card.style.display = match ? '' : 'none';
      card.classList.remove('allLeafletCard--search-hit');
      if (match) {
        matches += 1;
        if (!firstMatch) firstMatch = card;
      }
    });

    document.querySelectorAll('.leafletCategorySection').forEach((section) => {
      const hasVisibleCard = [...section.querySelectorAll('.allLeafletCard')].some((card) => card.style.display !== 'none');
      section.style.display = hasVisibleCard ? '' : 'none';
    });

    if (!matches || !firstMatch) {
      restoreAllCards();
      return false;
    }

    if (animate) firstMatch.classList.add('allLeafletCard--search-hit');
    if (scroll) {
      window.clearTimeout(selectionScrollTimer);
      selectionScrollTimer = window.setTimeout(() => {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 40);
    }
    if (animate) window.setTimeout(() => firstMatch.classList.remove('allLeafletCard--search-hit'), 1600);
    return true;
  }

  function selectStore(store, options = {}) {
    if (!store) return;
    selectedSlug = store.slug;
    input.value = store.name;
    clearButton.hidden = false;
    setLead(store);
    closeSuggestions();

    if (!applyStoreSelection(store, options)) {
      window.setTimeout(() => {
        const freshStore = storeBySlug(selectedSlug);
        if (freshStore) applyStoreSelection(freshStore, options);
      }, 250);
    }
  }

  function selectStoreBySlug(slug, options = {}) {
    const store = storeBySlug(slug);
    if (store) selectStore(store, options);
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
      selectStore(exact);
      return;
    }

    renderSuggestions();
    if (visibleStores[0]) selectStore(visibleStores[0]);
  }

  function clearSelection(options = {}) {
    selectedSlug = '';
    restoreAllCards();
    setLead();
    if (options.resetInput !== false) input.value = '';
    clearButton.hidden = !input.value;
  }

  function bringSearchIntoView() {
    window.clearTimeout(focusScrollTimer);

    const scrollSearch = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const rect = root.getBoundingClientRect();
      const topSafe = window.innerWidth <= 800 ? 72 : 88;
      const bottomSafe = window.innerWidth <= 800 ? Math.min(170, viewportHeight * .28) : 32;
      const isComfortablyVisible = rect.top >= topSafe && rect.bottom <= viewportHeight - bottomSafe;
      if (isComfortablyVisible) return;
      root.scrollIntoView({ behavior: 'smooth', block: window.innerWidth <= 800 ? 'center' : 'nearest' });
    };

    window.requestAnimationFrame(scrollSearch);
    if (window.innerWidth <= 800) focusScrollTimer = window.setTimeout(scrollSearch, 280);
  }

  input.addEventListener('focus', () => {
    bringSearchIntoView();
    renderSuggestions(!input.value.trim());
  });
  input.addEventListener('click', bringSearchIntoView);

  input.addEventListener('input', () => {
    if (selectedSlug) {
      selectedSlug = '';
      restoreAllCards();
    }
    setLead();
    clearButton.hidden = !input.value;
    activeIndex = 0;
    renderSuggestions();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestions.hidden) renderSuggestions(!input.value.trim());
      else if (visibleStores.length) {
        activeIndex = (activeIndex + 1) % visibleStores.length;
        suggestions.innerHTML = visibleStores.map(resultMarkup).join('');
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.hidden) renderSuggestions(!input.value.trim());
      else if (visibleStores.length) {
        activeIndex = (activeIndex - 1 + visibleStores.length) % visibleStores.length;
        suggestions.innerHTML = visibleStores.map(resultMarkup).join('');
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!suggestions.hidden && visibleStores[activeIndex]) selectStore(visibleStores[activeIndex]);
      else chooseBest();
    } else if (event.key === 'Escape') {
      closeSuggestions();
      input.blur();
    }
  });

  suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-store-slug]');
    if (!button) return;
    event.preventDefault();
    selectStoreBySlug(button.dataset.storeSlug);
  });

  searchButton.addEventListener('click', chooseBest);

  clearButton.addEventListener('click', () => {
    clearSelection();
    input.focus();
    renderSuggestions(true);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) closeSuggestions();
  });

  const observer = new MutationObserver(() => {
    if (!suggestions.hidden) renderSuggestions(!input.value.trim());
    if (!selectedSlug) return;

    window.requestAnimationFrame(() => {
      const store = storeBySlug(selectedSlug);
      if (!store) return;
      setLead(store);
      applyStoreSelection(store, { scroll: false, animate: false });
    });
  });
  observer.observe(categoriesRoot, { childList: true });

  setLead();
})();
