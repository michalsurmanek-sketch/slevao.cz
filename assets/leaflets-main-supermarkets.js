(() => {
  'use strict';

  const input = document.getElementById('leafletsStoreSearchInput');
  const suggestions = document.getElementById('leafletsStoreSuggestions');
  if (!input || !suggestions) return;

  const MAIN_SUPERMARKETS = [
    'lidl',
    'kaufland',
    'penny',
    'albert',
    'tesco',
    'billa',
    'globus',
    'coop',
  ];

  const FOOD_FALLBACK = [
    'terno',
    'norma',
    'hruska',
    'flop',
    'eso-market',
    'makro',
    'kosik',
    'rohlik',
  ];

  const FORCED_LOGOS = {
    globus: 'assets/logos/globus.svg?v=1',
  };

  let activeIndex = 0;
  let applying = false;
  let applyTimer = 0;
  let settleTimer = 0;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  }[character]));

  function currentStores() {
    const items = Array.isArray(window.__slevaoAllLeaflets) ? window.__slevaoAllLeaflets : [];
    const bySlug = new Map();

    items.forEach((item) => {
      const slug = String(item?.store_slug || '').toLowerCase();
      if (!slug) return;

      if (!bySlug.has(slug)) {
        bySlug.set(slug, {
          slug,
          name: String(item.store_name || slug),
          logo: FORCED_LOGOS[slug] || item.logo_url || '',
          category: item.category || 'other',
          count: 0,
        });
      }

      const store = bySlug.get(slug);
      store.count += 1;
      if (FORCED_LOGOS[slug]) store.logo = FORCED_LOGOS[slug];
      else if (!store.logo && item.logo_url) store.logo = item.logo_url;
    });

    return bySlug;
  }

  function foodSuggestions() {
    const stores = currentStores();
    const chosen = [];
    const used = new Set();

    [...MAIN_SUPERMARKETS, ...FOOD_FALLBACK].forEach((slug) => {
      const store = stores.get(slug);
      if (!store || used.has(slug) || store.category !== 'food') return;
      used.add(slug);
      chosen.push(store);
    });

    if (chosen.length < 8) {
      [...stores.values()]
        .filter((store) => store.category === 'food' && !used.has(store.slug))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
        .forEach((store) => {
          if (chosen.length >= 8) return;
          used.add(store.slug);
          chosen.push(store);
        });
    }

    return chosen.slice(0, 8);
  }

  function markup(store, index) {
    const logo = store.logo
      ? `<img src="${esc(store.logo)}" alt="" loading="lazy" decoding="async">`
      : '<span class="leafletsStoreSuggestionMark" aria-hidden="true">%</span>';

    return `<button type="button" class="leafletsStoreSuggestion${index === activeIndex ? ' is-active' : ''}" data-store-slug="${esc(store.slug)}" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}">
      <span class="leafletsStoreSuggestionLogo">${logo}</span>
      <span class="leafletsStoreSuggestionText"><strong>${esc(store.name)}</strong><small>Potraviny</small></span>
      <span class="leafletsStoreSuggestionCount">${store.count} ${store.count === 1 ? 'leták' : store.count < 5 ? 'letáky' : 'letáků'}</span>
    </button>`;
  }

  function alreadyRendered(stores) {
    if (suggestions.dataset.mainSupermarkets !== '1') return false;
    const buttons = [...suggestions.querySelectorAll(':scope > [data-store-slug]')];
    if (buttons.length !== stores.length) return false;

    return buttons.every((button, index) => {
      const store = stores[index];
      if (!store || button.dataset.storeSlug !== store.slug) return false;
      const img = button.querySelector('.leafletsStoreSuggestionLogo img');
      const renderedLogo = img?.getAttribute('src') || '';
      return renderedLogo === (store.logo || '');
    });
  }

  function applyMainSupermarkets() {
    if (input.value.trim() || suggestions.hidden || applying) return;

    const stores = foodSuggestions();
    if (!stores.length || alreadyRendered(stores)) return;

    applying = true;
    activeIndex = Math.min(activeIndex, stores.length - 1);
    suggestions.innerHTML = stores.map(markup).join('');
    suggestions.dataset.mainSupermarkets = '1';
    applying = false;
  }

  function scheduleApply() {
    window.clearTimeout(applyTimer);
    window.clearTimeout(settleTimer);
    applyTimer = window.setTimeout(applyMainSupermarkets, 0);
    settleTimer = window.setTimeout(applyMainSupermarkets, 100);
  }

  input.addEventListener('focus', scheduleApply);
  input.addEventListener('click', scheduleApply);
  input.addEventListener('input', () => {
    if (input.value.trim()) {
      suggestions.removeAttribute('data-main-supermarkets');
      activeIndex = 0;
      return;
    }
    scheduleApply();
  });

  input.addEventListener('keydown', (event) => {
    if (input.value.trim() || suggestions.hidden || suggestions.dataset.mainSupermarkets !== '1') return;

    const buttons = [...suggestions.querySelectorAll('[data-store-slug]')];
    if (!buttons.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeIndex = (activeIndex + 1) % buttons.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeIndex = (activeIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      buttons[activeIndex]?.click();
      return;
    } else {
      return;
    }

    buttons.forEach((button, index) => {
      const active = index === activeIndex;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }, true);

  const observer = new MutationObserver(() => {
    if (applying || input.value.trim() || suggestions.hidden) return;
    scheduleApply();
  });
  observer.observe(suggestions, { childList: true });
})();
