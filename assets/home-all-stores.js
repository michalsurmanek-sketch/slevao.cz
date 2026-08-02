(() => {
  'use strict';
  if (window.__slevaoAllStoresLoaded) return;
  window.__slevaoAllStoresLoaded = true;

  if (!document.querySelector('script[data-manual-leaflet-images]')) {
    const manual = document.createElement('script');
    manual.src = `assets/home-manual-leaflet-images.js?v=20260802-1-${Date.now()}`;
    manual.async = false;
    manual.dataset.manualLeafletImages = 'true';
    document.head.append(manual);
  }

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const STORE_PRIORITY = [
    'lidl', 'kaufland', 'penny', 'albert', 'tesco', 'billa', 'globus', 'makro',
    'action', 'coop', 'hruska', 'norma', 'terno', 'rohlik', 'kosik',
    'dm', 'rossmann', 'teta', 'alza', 'datart', 'planeo',
    'ikea', 'jysk', 'obi', 'hornbach', 'bauhaus', 'mountfield',
    'dr-max', 'benu', 'pilulka', 'pepco', 'kik',
  ];
  const STORE_RANK = new Map(STORE_PRIORITY.map((slug, index) => [slug, index]));
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  let stores = [];
  let selectedStore = 'all';
  let scheduled = 0;
  let syncing = false;

  function rankStore(store) {
    return STORE_RANK.has(store.slug) ? STORE_RANK.get(store.slug) : STORE_PRIORITY.length + 100;
  }

  function sortStores(rows) {
    return [...rows].sort((a, b) => rankStore(a) - rankStore(b)
      || String(a.name || '').localeCompare(String(b.name || ''), 'cs'));
  }

  async function loadStores() {
    const query = new URLSearchParams({
      select: 'id,name,slug,logo_url,primary_color,is_active',
      is_active: 'eq.true',
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Seznam obchodů vrátil HTTP ${response.status}.`);
    stores = sortStores((await response.json()).filter((store) => store?.slug && store?.name));
  }

  function logoHtml(store) {
    if (!store.logo_url) return '<span class="storeAllIcon">🏪</span>';
    return `<img src="${esc(store.logo_url)}" alt="Logo ${esc(store.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'storeAllIcon',textContent:'🏪'}))">`;
  }

  function createCard(store) {
    const article = document.createElement('article');
    article.className = `storeCard ${selectedStore === store.slug ? 'active' : ''}`;
    article.dataset.dynamicStoreCard = store.slug;
    article.innerHTML = `<a class="storePageLink" href="${encodeURIComponent(store.slug)}.html" title="Otevřít stránku ${esc(store.name)}">↗</a><button class="storeFilterButton" data-store="${esc(store.slug)}"><div class="storeLogoBox">${logoHtml(store)}</div>${esc(store.name)}</button>`;
    return article;
  }

  function currentStoreCards(grid) {
    const map = new Map();
    grid.querySelectorAll('.storeCard [data-store]').forEach((button) => {
      const slug = button.dataset.store;
      const card = button.closest('.storeCard');
      if (slug && card) map.set(slug, card);
    });
    return map;
  }

  function syncDropdown() {
    const select = $('storeSelect');
    if (!select) return;
    const existing = new Map([...select.options].map((option) => [option.value, option]));
    stores.forEach((store) => {
      if (existing.has(store.slug)) return;
      select.add(new Option(store.name, store.slug));
    });
    const allOption = select.querySelector('option[value="all"]');
    const ordered = [allOption, ...stores.map((store) => select.querySelector(`option[value="${CSS.escape(store.slug)}"]`))].filter(Boolean);
    ordered.forEach((option) => select.append(option));
    select.value = selectedStore;
  }

  function syncGrid() {
    const grid = $('storeGrid');
    if (!grid || !stores.length || syncing) return;
    syncing = true;
    try {
      const toggle = $('showAllStores');
      const expanded = toggle?.textContent.trim() === 'Zobrazit méně';
      const desired = expanded ? stores : stores.slice(0, 11);
      const cards = currentStoreCards(grid);
      const allCard = cards.get('all') || grid.querySelector('.storeCard');
      const desiredSlugs = ['all', ...desired.map((store) => store.slug)];
      const currentSlugs = [...grid.querySelectorAll('.storeCard [data-store]')].map((button) => button.dataset.store);

      if (currentSlugs.join('|') !== desiredSlugs.join('|')) {
        const fragment = document.createDocumentFragment();
        if (allCard) fragment.append(allCard);
        desired.forEach((store) => fragment.append(cards.get(store.slug) || createCard(store)));
        grid.replaceChildren(fragment);
      }

      grid.querySelectorAll('.storeCard').forEach((card) => {
        card.classList.toggle('active', card.querySelector('[data-store]')?.dataset.store === selectedStore);
      });
      if ($('storeCount')) $('storeCount').textContent = stores.length.toLocaleString('cs-CZ');
      if (toggle) toggle.textContent = expanded ? 'Zobrazit méně' : `Zobrazit všechny (${stores.length})`;
      syncDropdown();
    } finally {
      syncing = false;
    }
  }

  function scheduleSync() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(syncGrid, 40);
  }

  function bindSelection() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('#storeGrid [data-store]');
      if (!button) return;
      selectedStore = button.dataset.store || 'all';
      scheduleSync();
    }, true);
    $('storeSelect')?.addEventListener('change', (event) => {
      selectedStore = event.target.value || 'all';
      scheduleSync();
    }, true);
  }

  async function init() {
    const grid = $('storeGrid');
    if (!grid) return;
    bindSelection();
    new MutationObserver(scheduleSync).observe(grid, { childList: true, subtree: true });
    try {
      await loadStores();
      scheduleSync();
      window.setInterval(async () => {
        try { await loadStores(); scheduleSync(); } catch (error) { console.warn('Aktualizace obchodů selhala:', error); }
      }, 5 * 60 * 1000);
    } catch (error) {
      console.warn('Všechny aktivní obchody se nepodařilo načíst:', error);
    }
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
