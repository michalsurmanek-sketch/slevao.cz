(() => {
  'use strict';

  const input = document.getElementById('leafletsStoreSearchInput');
  const suggestions = document.getElementById('leafletsStoreSuggestions');
  const categories = document.getElementById('leafletCategories');
  if (!input || !suggestions || !categories) return;

  const MAIN_STORES = ['lidl', 'kaufland', 'penny', 'albert', 'tesco', 'billa', 'globus', 'coop'];
  const FORCED_LOGOS = {
    globus: 'assets/logos/globus.svg?v=1',
  };

  let activeIndex = 0;
  let timers = [];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  }[character]));

  function clearTimers() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  }

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

  function mainStoreList() {
    const stores = currentStores();
    const result = [];
    const used = new Set();

    MAIN_STORES.forEach((slug) => {
      const store = stores.get(slug);
      if (!store || used.has(slug)) return;
      used.add(slug);
      result.push(store);
    });

    if (result.length < 8) {
      [...stores.values()]
        .filter((store) => store.category === 'food' && !used.has(store.slug))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
        .forEach((store) => {
          if (result.length >= 8) return;
          used.add(store.slug);
          result.push(store);
        });
    }

    return result.slice(0, 8);
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

  function renderMainStores() {
    if (input.value.trim() || suggestions.hidden) return;
    const stores = mainStoreList();
    if (!stores.length) return;

    activeIndex = Math.min(activeIndex, stores.length - 1);
    suggestions.innerHTML = stores.map(markup).join('');
    suggestions.dataset.mainStores = '1';
    input.setAttribute('aria-expanded', 'true');
  }

  function scheduleRender() {
    if (input.value.trim()) return;
    clearTimers();
    [0, 70, 180].forEach((delay) => timers.push(window.setTimeout(renderMainStores, delay)));
  }

  input.addEventListener('focus', scheduleRender);
  input.addEventListener('click', scheduleRender);
  input.addEventListener('input', () => {
    if (input.value.trim()) {
      suggestions.removeAttribute('data-main-stores');
      activeIndex = 0;
      clearTimers();
      return;
    }
    scheduleRender();
  });

  input.addEventListener('keydown', (event) => {
    if (input.value.trim() || suggestions.hidden || suggestions.dataset.mainStores !== '1') return;
    const buttons = [...suggestions.querySelectorAll(':scope > [data-store-slug]')];
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
    if (!input.value.trim() && !suggestions.hidden) scheduleRender();
  });
  observer.observe(categories, { childList: true });
})();
