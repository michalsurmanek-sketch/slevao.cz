(() => {
  'use strict';
  if (window.__slevaoAllStoresLoaded) return;
  window.__slevaoAllStoresLoaded = true;

  if (!document.querySelector('script[data-slevao-leaflet-control]')) {
    const control = document.createElement('script');
    control.src = `assets/home-leaflet-control.js?v=20260821-1`;
    control.defer = true;
    control.dataset.slevaoLeafletControl = 'true';
    document.head.append(control);
  }

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const STORE_REFRESH_MS = 5 * 60 * 1000;
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
  let scrollSequence = 0;
  let lastStoresRefreshAt = 0;

  function rankStore(store) {
    return STORE_RANK.has(store.slug) ? STORE_RANK.get(store.slug) : STORE_PRIORITY.length + 100;
  }

  function sortStores(rows) {
    return [...rows].sort((a, b) => rankStore(a) - rankStore(b)
      || String(a.name || '').localeCompare(String(b.name || ''), 'cs'));
  }

  function publishStoreDirectory() {
    const directory = stores.map((store) => ({
      name: store.name,
      slug: store.slug,
      logo_url: store.logo_url || null,
    }));
    window.__slevaoStoreDirectory = directory;
    document.dispatchEvent(new CustomEvent('slevao:store-directory', { detail: { stores: directory } }));
  }

  function feedStateLabel(store) {
    if (Number(store.current_offer_count || 0) > 0 || store.feed_status === 'products-live') return '';
    if (store.feed_status === 'leaflet-only') return 'Jen aktuální leták';
    if (store.feed_status === 'broken-source') return 'Zdroj se obnovuje';
    if (store.feed_status === 'temporarily-empty') return 'Dočasně bez nabídek';
    if (store.feed_status === 'source-blocked') return 'Nabídky teď nejsou dostupné';
    if (store.feed_status === 'not-applicable') return 'Bez online nabídky';
    return store.feed_status ? 'Zatím bez nabídek' : '';
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async function loadStores() {
    const healthQuery = new URLSearchParams({
      select: 'store_id,name,slug,logo_url,primary_color,is_active,feed_status,current_offer_count,current_leaflet_count,image_coverage_pct,health_score',
      is_active: 'eq.true',
    });

    let rows = [];
    try {
      rows = await fetchJson(`${SUPABASE_URL}/rest/v1/public_store_feed_health?${healthQuery}`);
    } catch (error) {
      console.warn('Stav obchodů je dočasně nedostupný, používám základní seznam obchodů:', error);
      const fallbackQuery = new URLSearchParams({
        select: 'id,name,slug,logo_url,primary_color,is_active',
        is_active: 'eq.true',
      });
      rows = (await fetchJson(`${SUPABASE_URL}/rest/v1/stores?${fallbackQuery}`)).map((store) => ({
        ...store,
        store_id: store.id,
        feed_status: null,
        current_offer_count: null,
        current_leaflet_count: null,
        image_coverage_pct: null,
        health_score: null,
      }));
    }

    stores = sortStores(rows.filter((store) => store?.slug && store?.name));
    lastStoresRefreshAt = Date.now();
    publishStoreDirectory();
  }

  function logoHtml(store) {
    if (!store.logo_url) return '<span class="storeAllIcon">🏪</span>';
    return `<img src="${esc(store.logo_url)}" alt="Logo ${esc(store.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'storeAllIcon',textContent:'🏪'}))">`;
  }

  function createCard(store) {
    const article = document.createElement('article');
    article.className = `storeCard ${selectedStore === store.slug ? 'active' : ''}`;
    article.dataset.dynamicStoreCard = store.slug;
    article.dataset.feedStatus = store.feed_status || 'supported';
    const state = feedStateLabel(store);
    article.innerHTML = `<a class="storePageLink" href="${encodeURIComponent(store.slug)}.html" title="Otevřít stránku ${esc(store.name)}">↗</a><button class="storeFilterButton" data-store="${esc(store.slug)}"><div class="storeLogoBox">${logoHtml(store)}</div>${esc(store.name)}${state ? `<br><small>${esc(state)}</small>` : ''}</button>`;
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
      const state = feedStateLabel(store);
      const label = state ? `${store.name} — ${state}` : store.name;
      if (existing.has(store.slug)) {
        existing.get(store.slug).textContent = label;
        return;
      }
      select.add(new Option(label, store.slug));
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

  function stickyOffset() {
    const candidates = [
      document.querySelector('.siteHeader'),
      document.querySelector('.mainHeader'),
      document.querySelector('header'),
    ].filter(Boolean);
    const stickyHeight = candidates.reduce((height, element) => {
      const style = window.getComputedStyle(element);
      if (!['sticky', 'fixed'].includes(style.position)) return height;
      return Math.max(height, element.getBoundingClientRect().height || 0);
    }, 0);
    return Math.round(stickyHeight + 12);
  }

  function stabilizeDealsScroll() {
    const target = $('dealsSection');
    if (!target) return;
    const sequence = ++scrollSequence;
    const place = (behavior = 'auto') => {
      if (sequence !== scrollSequence) return;
      const y = Math.max(0, window.scrollY + target.getBoundingClientRect().top - stickyOffset());
      window.scrollTo({ top: y, behavior });
    };

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => place('smooth')));
    [90, 180, 320, 520].forEach((delay) => window.setTimeout(() => place('auto'), delay));
  }

  function bindSelection() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('#storeGrid [data-store]');
      if (!button) return;
      selectedStore = button.dataset.store || 'all';
      scheduleSync();
      stabilizeDealsScroll();
    }, true);
    $('storeSelect')?.addEventListener('change', (event) => {
      selectedStore = event.target.value || 'all';
      scheduleSync();
      stabilizeDealsScroll();
    }, true);
  }

  async function refreshStores() {
    try {
      await loadStores();
      scheduleSync();
    } catch (error) {
      console.warn('Aktualizace obchodů selhala:', error);
    }
  }

  async function init() {
    const grid = $('storeGrid');
    if (!grid) return;
    bindSelection();
    new MutationObserver(scheduleSync).observe(grid, { childList: true, subtree: true });
    try {
      await loadStores();
      scheduleSync();
      window.setInterval(() => {
        if (!document.hidden) refreshStores();
      }, STORE_REFRESH_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (Date.now() - lastStoresRefreshAt >= STORE_REFRESH_MS) refreshStores();
      });
    } catch (error) {
      console.warn('Všechny aktivní obchody se nepodařilo načíst:', error);
    }
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();