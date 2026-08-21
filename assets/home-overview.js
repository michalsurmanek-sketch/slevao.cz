(() => {
  'use strict';

  if (window.__slevaoDesktopOverviewLoaded) return;
  window.__slevaoDesktopOverviewLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PRAGUE_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const pragueToday = () => PRAGUE_DAY_FORMAT.format(new Date());
  const LEAFLETS_PER_PAGE = 3;
  const STORES_PER_PAGE = 8;
  const ENDING_VISIBLE = 3;
  const AUTO_ROTATE_MS = 10000;
  const DATA_REFRESH_MS = 5 * 60 * 1000;
  const STORE_PRIORITY = [
    'lidl', 'kaufland', 'penny', 'albert', 'tesco', 'billa', 'globus', 'makro',
    'action', 'coop', 'hruska', 'norma', 'terno', 'rohlik', 'kosik',
    'dm', 'rossmann', 'teta', 'alza', 'datart', 'planeo',
    'ikea', 'jysk', 'obi', 'hornbach', 'bauhaus', 'mountfield',
    'dr-max', 'benu', 'pilulka', 'pepco', 'kik'
  ];

  const STORE_RANK = new Map(STORE_PRIORITY.map((slug, index) => [slug, index]));
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });

  let renderTimer = 0;
  let fitFrame = 0;
  let autoRotateTimer = 0;
  let leafletPage = 0;
  let storePage = 0;
  let leafletPageCount = 1;
  let storePageCount = 1;
  let overviewStores = [];
  let endingOffers = [];
  let endingOffset = 0;
  let lastOverviewRefreshAt = 0;
  let lastOverviewDay = '';

  function pagerMarkup(type, label) {
    return `<div class="overviewPager" aria-label="${label}">
      <button type="button" class="overviewArrow" data-overview-nav="${type}" data-direction="-1" aria-label="Předchozí ${label.toLowerCase()}">‹</button>
      <span id="overview-${type}-page" class="overviewPageCount" aria-live="polite">1/1</span>
      <button type="button" class="overviewArrow" data-overview-nav="${type}" data-direction="1" aria-label="Další ${label.toLowerCase()}">›</button>
    </div>`;
  }

  function shell() {
    if ($('desktopOverview') || !$('categoriesSection')) return;

    const section = document.createElement('section');
    section.id = 'desktopOverview';
    section.className = 'desktopOverview';
    section.setAttribute('aria-label', 'Rychlý přehled akcí a obchodů');
    section.innerHTML = `<div class="container desktopOverviewGrid">
      <article class="overviewPanel">
        <div class="overviewPanelHead">
          <h2>Top letáky</h2>
          <div class="overviewHeadActions">${pagerMarkup('leaflets', 'Letáky')}<button type="button" class="overviewAllLink" data-show-section="leaflets">Zobrazit všechny</button></div>
        </div>
        <div id="overviewLeaflets" class="overviewLeaflets"><span class="overviewLoading">Načítám letáky…</span></div>
      </article>
      <article class="overviewPanel">
        <div class="overviewPanelHead">
          <h2>Nejžádanější obchody</h2>
          <div class="overviewHeadActions">${pagerMarkup('stores', 'Obchody')}<button type="button" class="overviewAllLink" data-show-section="stores">Zobrazit všechny</button></div>
        </div>
        <div id="overviewStores" class="overviewStores"><span class="overviewLoading">Načítám obchody…</span></div>
      </article>
      <article class="overviewPanel">
        <div class="overviewPanelHead"><h2>Akce končí brzy</h2><button type="button" class="overviewAllLink" data-show-ending>Zobrazit všechny</button></div>
        <div id="overviewEnding" class="overviewEnding"><span class="overviewLoading">Načítám akce…</span></div>
      </article>
    </div>`;

    $('categoriesSection').insertAdjacentElement('afterend', section);
    bind(section);
  }

  function clean(node) {
    node.removeAttribute('id');
    node.hidden = false;
    node.removeAttribute('aria-hidden');
    node.style.removeProperty('display');
    node.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    return node;
  }

  function normalizePage(current, total) {
    if (total <= 1) return 0;
    return ((current % total) + total) % total;
  }

  function updatePager(type, current, total) {
    const counter = $(`overview-${type}-page`);
    if (counter) counter.textContent = `${current + 1}/${Math.max(total, 1)}`;

    document.querySelectorAll(`[data-overview-nav="${type}"]`).forEach((button) => {
      const disabled = total <= 1;
      button.disabled = disabled;
      button.setAttribute('aria-disabled', String(disabled));
    });
  }

  function syncLeaflets() {
    const source = $('leafletGrid');
    const target = $('overviewLeaflets');
    if (!source || !target) return;

    const allCards = [...source.querySelectorAll('.leafletCard')]
      .filter((card) => !card.hidden && card.dataset.homeLeafletVisibility !== 'hidden');

    leafletPageCount = Math.max(1, Math.ceil(allCards.length / LEAFLETS_PER_PAGE));
    leafletPage = normalizePage(leafletPage, leafletPageCount);
    const start = leafletPage * LEAFLETS_PER_PAGE;
    const cards = allCards.slice(start, start + LEAFLETS_PER_PAGE).map((card) => {
      const clone = clean(card.cloneNode(true));
      clone.classList.add('overviewLeafletCard');
      return clone;
    });

    target.replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement('span'), {
      className: 'overviewLoading', textContent: 'Aktuální letáky se načítají…'
    })]));
    updatePager('leaflets', leafletPage, leafletPageCount);
  }

  function storeLogoMarkup(store) {
    if (store.logo_url) {
      return `<img src="${esc(store.logo_url)}" alt="Logo ${esc(store.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'storeAllIcon',textContent:'🏪'}))">`;
    }
    return '<span class="storeAllIcon">🏪</span>';
  }

  function storeCardMarkup(store) {
    return `<article class="storeCard overviewStoreCard">
      <button type="button" class="storeFilterButton" data-store="${esc(store.slug)}">
        <div class="storeLogoBox">${storeLogoMarkup(store)}</div>${esc(store.name)}
      </button>
    </article>`;
  }

  function fallbackStoresFromGrid() {
    const source = $('storeGrid');
    if (!source) return [];

    return [...source.querySelectorAll('.storeCard')].filter((card) => {
      const slug = card.querySelector('[data-store]')?.dataset.store;
      return slug && slug !== 'all' && !card.hidden;
    });
  }

  function syncStores() {
    const target = $('overviewStores');
    if (!target) return;

    if (overviewStores.length) {
      storePageCount = Math.max(1, Math.ceil(overviewStores.length / STORES_PER_PAGE));
      storePage = normalizePage(storePage, storePageCount);
      const start = storePage * STORES_PER_PAGE;
      const rows = overviewStores.slice(start, start + STORES_PER_PAGE);
      target.innerHTML = rows.length
        ? rows.map(storeCardMarkup).join('')
        : '<span class="overviewLoading">Obchody se načítají…</span>';
    } else {
      const allCards = fallbackStoresFromGrid();
      storePageCount = Math.max(1, Math.ceil(allCards.length / STORES_PER_PAGE));
      storePage = normalizePage(storePage, storePageCount);
      const start = storePage * STORES_PER_PAGE;
      const cards = allCards.slice(start, start + STORES_PER_PAGE).map((card) => {
        const clone = clean(card.cloneNode(true));
        clone.classList.add('overviewStoreCard');
        clone.querySelector('.storePageLink')?.remove();
        return clone;
      });

      target.replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement('span'), {
        className: 'overviewLoading', textContent: 'Obchody se načítají…'
      })]));
    }

    updatePager('stores', storePage, storePageCount);
  }

  function fitPanels() {
    const grid = document.querySelector('.desktopOverviewGrid');
    if (!grid || window.matchMedia('(max-width:1100px)').matches) return;

    cancelAnimationFrame(fitFrame);
    grid.style.removeProperty('--overview-panel-height');
    fitFrame = requestAnimationFrame(() => {
      const first = grid.querySelector('.overviewPanel');
      if (!first) return;
      const height = Math.ceil(first.scrollHeight);
      if (height > 0) grid.style.setProperty('--overview-panel-height', `${height}px`);
    });
  }

  function schedule() {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      syncLeaflets();
      syncStores();
      fitPanels();
    }, 100);
  }

  function relay(slug) {
    const query = `[data-store="${CSS.escape(slug)}"]`;
    const button = $('storeGrid')?.querySelector(query) || $('leafletGrid')?.querySelector(query);

    if (button) button.click();
    else {
      const select = $('storeSelect');
      if (select) {
        select.value = slug;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    window.setTimeout(() => $('dealsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function show(type) {
    const stores = type === 'stores';
    document.body.classList.add(stores ? 'showOriginalStores' : 'showOriginalLeaflets');
    requestAnimationFrame(() => $(stores ? 'storesSection' : 'leafletsSection')?.scrollIntoView({
      behavior: 'smooth', block: 'start'
    }));
  }

  function showEnding() {
    const select = $('sortSelect');
    if (select) {
      select.value = 'ending';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $('dealsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function changePage(type, direction) {
    if (type === 'leaflets') {
      if (leafletPageCount <= 1) return false;
      leafletPage = normalizePage(leafletPage + direction, leafletPageCount);
      syncLeaflets();
    } else if (type === 'stores') {
      if (storePageCount <= 1) return false;
      storePage = normalizePage(storePage + direction, storePageCount);
      syncStores();
    } else {
      return false;
    }

    fitPanels();
    return true;
  }

  function clearAutoRotate() {
    window.clearInterval(autoRotateTimer);
    autoRotateTimer = 0;
  }

  function startAutoRotate() {
    clearAutoRotate();
    if (document.hidden) return;

    autoRotateTimer = window.setInterval(() => {
      if (document.hidden) return;
      changePage('leaflets', 1);
      changePage('stores', 1);
      advanceEndingRow();
    }, AUTO_ROTATE_MS);
  }

  function bind(section) {
    section.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-overview-nav]');
      if (nav) {
        changePage(nav.dataset.overviewNav, Number(nav.dataset.direction || 1));
        startAutoRotate();
        return;
      }

      const showButton = event.target.closest('[data-show-section]');
      if (showButton) {
        show(showButton.dataset.showSection);
        return;
      }

      if (event.target.closest('[data-show-ending]')) {
        showEnding();
        return;
      }

      const storeButton = event.target.closest('button[data-store]');
      if (!storeButton) return;
      event.preventDefault();
      event.stopPropagation();
      relay(storeButton.dataset.store || 'all');
    });
  }

  function calendarOrdinal(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return Number.NaN;
    return Math.trunc(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
  }

  function days(value) {
    if (!value) return 999;
    const target = calendarOrdinal(value);
    const today = calendarOrdinal(pragueToday());
    if (!Number.isFinite(target) || !Number.isFinite(today)) return 999;
    return Math.max(0, target - today);
  }

  function endingLabel(value) {
    const count = days(value);
    if (count === 0) return 'Končí dnes';
    if (count === 1) return 'Končí zítra';
    return count < 5 ? `Končí za ${count} dny` : `Končí za ${count} dní`;
  }

  function offerLogo(store) {
    return store?.logo_url
      ? `<img src="${esc(store.logo_url)}" alt="Logo ${esc(store.name || '')}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'overviewLogoFallback',textContent:'%'}))">`
      : '<span class="overviewLogoFallback">%</span>';
  }

  function offerImage(offer) {
    return offer.image_url || offer.products?.image_url || '';
  }

  function endingOfferMarkup(offer) {
    const store = offer.stores || {};
    const title = offer.title || offer.products?.name || 'Akční nabídka';
    const image = offerImage(offer);
    const price = Number(offer.price || 0);
    const oldPrice = Number(offer.old_price || 0);
    const discount = oldPrice > price ? Math.round((oldPrice - price) / oldPrice * 100) : 0;
    const productId = String(offer.product_id || '').trim();
    const href = productId
      ? `produkt.html?id=${encodeURIComponent(productId)}`
      : (store.slug ? `${encodeURIComponent(store.slug)}.html` : '#dealsSection');
    const productLink = productId ? ` data-product-detail-link="1" aria-label="Zobrazit detail produktu ${esc(title)}"` : '';

    return `<a class="overviewDealRow" href="${href}"${productLink}>
      <span class="overviewDealImage">${image ? `<img src="${esc(image)}" alt="${esc(title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '<span class="overviewProductFallback">🏷️</span>'}</span>
      <span class="overviewDealCopy"><strong>${esc(title)}</strong><small>${offerLogo(store)}${esc(store.name || 'Obchod')}</small></span>
      <span class="overviewEndingBadge">${endingLabel(offer.valid_to)}</span>
      <span class="overviewDealPrice"><strong>${money(price)} Kč</strong>${oldPrice > price ? `<del>${money(oldPrice)} Kč</del>` : ''}</span>
      ${discount ? `<span class="overviewDiscount">−${discount}%</span>` : ''}
    </a>`;
  }

  function renderEndingWindow() {
    const target = $('overviewEnding');
    if (!target) return;

    if (!endingOffers.length) {
      target.innerHTML = '<span class="overviewLoading">Žádná akce nyní nekončí.</span>';
      fitPanels();
      return;
    }

    endingOffset = normalizePage(endingOffset, endingOffers.length);
    const visibleCount = Math.min(ENDING_VISIBLE, endingOffers.length);
    const visibleOffers = Array.from({ length: visibleCount }, (_, index) => (
      endingOffers[(endingOffset + index) % endingOffers.length]
    ));

    target.innerHTML = visibleOffers.map(endingOfferMarkup).join('');
    fitPanels();
  }

  function advanceEndingRow() {
    if (endingOffers.length <= ENDING_VISIBLE) return false;
    endingOffset = normalizePage(endingOffset + 1, endingOffers.length);
    renderEndingWindow();
    return true;
  }

  function renderEnding(rows) {
    const unique = new Map();
    rows.forEach((offer) => {
      const key = `${offer.stores?.slug || ''}|${String(offer.title || offer.products?.name || '').toLowerCase()}`;
      const current = unique.get(key);
      if (!current || (!offerImage(current) && offerImage(offer))) unique.set(key, offer);
    });

    endingOffers = [...unique.values()]
      .sort((a, b) => days(a.valid_to) - days(b.valid_to)
        || (Number(b.old_price || 0) - Number(b.price || 0)) - (Number(a.old_price || 0) - Number(a.price || 0)))
      .slice(0, 24);

    endingOffset = normalizePage(endingOffset, endingOffers.length);
    renderEndingWindow();
  }

  async function loadEnding() {
    const target = $('overviewEnding');
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_offer_page_filtered`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          p_limit: 40,
          p_offset: 0,
          p_include_upcoming: false,
          p_store_slug: null,
          p_min_price: null,
          p_max_price: null,
          p_only_images: false,
          p_sort: 'ending',
          p_query: null,
          p_filter_group: null,
          p_region_code: null,
          p_city_name: null,
          p_mode: 'all'
        }),
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      renderEnding((Array.isArray(rows) ? rows : []).map((row) => row?.offer).filter(Boolean));
    } catch (error) {
      console.warn('Přehled končících akcí se nepodařilo načíst:', error);
      endingOffers = [];
      if (target) target.innerHTML = '<span class="overviewLoading">Akce se nyní nepodařilo načíst.</span>';
      fitPanels();
    }
  }

  function applyStoreDirectory(rows) {
    overviewStores = (Array.isArray(rows) ? rows : [])
      .filter((store) => store?.slug && store?.name)
      .sort((a, b) => (STORE_RANK.get(a.slug) ?? 999) - (STORE_RANK.get(b.slug) ?? 999)
        || String(a.name).localeCompare(String(b.name), 'cs'));
    syncStores();
    fitPanels();
  }

  async function loadOverviewStores() {
    const directory = Array.isArray(window.__slevaoStoreDirectory) ? window.__slevaoStoreDirectory : [];
    if (directory.length) applyStoreDirectory(directory);
    else syncStores();
  }

  async function refreshOverviewData() {
    if (document.hidden) return;
    await Promise.allSettled([loadEnding(), loadOverviewStores()]);
    lastOverviewRefreshAt = Date.now();
    lastOverviewDay = pragueToday();
  }

  function observe(id, options) {
    const node = $(id);
    if (!node) return;
    new MutationObserver(schedule).observe(node, options);
  }

  function init() {
    shell();
    schedule();
    observe('leafletGrid', {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'hidden', 'style', 'class']
    });
    observe('storeGrid', { childList: true, subtree: true });
    document.addEventListener('slevao:store-directory', (event) => applyStoreDirectory(event.detail?.stores));
    refreshOverviewData();

    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearAutoRotate();
        return;
      }
      startAutoRotate();
      const today = pragueToday();
      if (today !== lastOverviewDay || Date.now() - lastOverviewRefreshAt >= DATA_REFRESH_MS) refreshOverviewData();
    });

    window.setInterval(() => {
      if (!document.hidden) refreshOverviewData();
    }, DATA_REFRESH_MS);
    startAutoRotate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();