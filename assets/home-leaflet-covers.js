(() => {
  'use strict';

  window.__slevaoDedicatedLeafletGrid = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PRAGUE_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const pragueToday = () => PRAGUE_DAY_FORMAT.format(new Date());
  const MAX_CARDS = 12;
  const COVER_CONCURRENCY = 5;
  const CACHE_NAME = 'slevao-homepage-leaflet-covers-v6';
  const META_CACHE_KEY = 'slevao-homepage-leaflets-meta-v6';
  const META_CACHE_TTL = 30 * 60 * 1000;
  const FORCE_KEY = 'slevao-leaflet-force';
  const VISIBILITY_KEY = 'slevao-leaflet-visibility';
  const PRIORITY_SLUGS = [
    'penny', 'kaufland', 'lidl', 'tesco', 'makro', 'albert', 'billa', 'globus',
    'coop', 'hruska', 'norma', 'terno', 'action', 'dm', 'rossmann', 'teta',
  ];
  const LOCAL_LOGOS = {
    penny: 'assets/logos/penny.svg?v=4',
    'eso-market': 'assets/logos/eso-market.svg?v=1',
  };
  const PDF_SOURCES = [
    {
      module: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
      worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
    },
    {
      module: 'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.min.mjs',
      worker: 'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
    },
  ];

  let pdfjsPromise = null;
  let renderGeneration = 0;
  let rendering = false;
  let cacheRefreshTimer = 0;
  const objectUrls = new Set();

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function marker(store, key) {
    for (const value of [store?.website_url, store?.logo_url]) {
      try {
        const url = new URL(String(value || ''), location.href);
        const params = new URLSearchParams(url.hash.replace(/^#/, ''));
        if (params.has(key)) return params.get(key) || '';
      } catch {}
    }
    return '';
  }

  function readMetaCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(META_CACHE_KEY) || 'null');
      if (!cached || !Array.isArray(cached.leaflets)) return null;
      const today = pragueToday();
      const current = cached.leaflets.filter((item) => (!item.valid_from || item.valid_from <= today) && (!item.valid_to || item.valid_to >= today));
      if (!current.length) return null;
      return { ...cached, leaflets: current.slice(0, MAX_CARDS) };
    } catch {
      return null;
    }
  }

  function writeMetaCache(leaflets) {
    try {
      localStorage.setItem(META_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), leaflets }));
    } catch {}
  }

  function scheduleFreshCacheRefresh(cachedMeta) {
    window.clearTimeout(cacheRefreshTimer);
    const savedAt = Number(cachedMeta?.savedAt || 0);
    if (!savedAt) return;
    const delay = Math.max(1000, META_CACHE_TTL - Math.max(0, Date.now() - savedAt));
    cacheRefreshTimer = window.setTimeout(() => {
      cacheRefreshTimer = 0;
      if (document.hidden || rendering) return;
      renderSection(true);
    }, delay);
  }

  function formatDate(value) {
    if (!value) return '';
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(parsed);
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function loadLeafletStoreRows(force = false) {
    if (typeof window.__slevaoLoadLeafletStoreRows !== 'function') {
      let rows = [];
      let pending = null;
      window.__slevaoLoadLeafletStoreRows = async (refresh = false) => {
        if (pending) return pending;
        if (!refresh && rows.length) return rows;

        const query = new URLSearchParams({
          select: 'id,slug,name,logo_url,website_url,is_active',
          is_active: 'eq.true',
          order: 'name.asc',
        });
        const request = fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
          headers: { apikey: SUPABASE_KEY },
          cache: 'no-store',
        }).then(async (response) => {
          if (!response.ok) throw new Error(`Obchody vrátily HTTP ${response.status}.`);
          rows = (await response.json()).filter((store) => store?.slug);
          window.__slevaoLeafletStoreRows = rows;
          return rows;
        }).finally(() => {
          pending = null;
        });
        pending = request;
        return request;
      };
    }
    return window.__slevaoLoadLeafletStoreRows(force);
  }

  async function activeStores() {
    const stores = await loadLeafletStoreRows(false);
    const priority = new Map(PRIORITY_SLUGS.map((slug, index) => [slug, index]));
    return stores
      .filter((store) => store?.slug)
      .filter((store) => marker(store, VISIBILITY_KEY) !== 'hidden')
      .sort((a, b) => {
        const aForced = marker(a, FORCE_KEY) === '1' ? 0 : 1;
        const bForced = marker(b, FORCE_KEY) === '1' ? 0 : 1;
        const aPriority = priority.has(a.slug) ? priority.get(a.slug) : 999;
        const bPriority = priority.has(b.slug) ? priority.get(b.slug) : 999;
        return aForced - bForced || aPriority - bPriority || String(a.name || '').localeCompare(String(b.name || ''), 'cs');
      });
  }

  async function currentLeaflets() {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/get_public_current_leaflets`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_limit: 240 }),
      cache: 'default',
    });
    if (!response.ok) throw new Error(`Aktuální letáky vrátily HTTP ${response.status}.`);

    const today = pragueToday();
    const firstByStore = new Map();
    for (const leaflet of await response.json()) {
      const slug = String(leaflet?.store_slug || '').trim();
      if (!slug || !leaflet?.preview_url || firstByStore.has(slug)) continue;
      if (leaflet.valid_from && leaflet.valid_from > today) continue;
      if (leaflet.valid_to && leaflet.valid_to < today) continue;
      firstByStore.set(slug, leaflet);
    }
    return firstByStore;
  }

  async function loadFreshLeaflets() {
    const [stores, leafletByStore] = await Promise.all([activeStores(), currentLeaflets()]);
    const leaflets = stores.map((store) => {
      const leaflet = leafletByStore.get(store.slug);
      if (!leaflet) return null;
      return {
        store_slug: store.slug,
        store_name: leaflet.store_name || store.name,
        logo_url: leaflet.logo_url || store.logo_url || LOCAL_LOGOS[store.slug] || null,
        title: leaflet.title || 'Aktuální leták',
        valid_from: leaflet.valid_from || null,
        valid_to: leaflet.valid_to || null,
        preview_url: String(leaflet.preview_url),
      };
    }).filter(Boolean).slice(0, MAX_CARDS);
    if (leaflets.length) writeMetaCache(leaflets);
    return leaflets;
  }

  async function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = (async () => {
        let lastError = null;
        for (const source of PDF_SOURCES) {
          try {
            const module = await import(source.module);
            module.GlobalWorkerOptions.workerSrc = source.worker;
            return module;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('PDF.js není dostupné.');
      })();
    }
    return pdfjsPromise;
  }

  function isPdf(blob, bytes) {
    if (String(blob.type || '').toLowerCase().includes('pdf')) return true;
    return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }

  async function fetchDocument(url) {
    let response = await fetchWithTimeout(url, {
      headers: { apikey: SUPABASE_KEY, accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
      cache: 'default',
    }, 22000);
    if (!response.ok) throw new Error(`Dokument vrátil HTTP ${response.status}.`);
    if (String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      const payload = await response.json();
      const redirectedUrl = String(payload?.url || '');
      if (!redirectedUrl.startsWith('https://')) throw new Error(payload?.error || 'Leták nevrátil platný dokument.');
      response = await fetchWithTimeout(redirectedUrl, {
        headers: { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
        cache: 'default',
      }, 22000);
      if (!response.ok) throw new Error(`Soubor vrátil HTTP ${response.status}.`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Dokument letáku je prázdný.');
    return blob;
  }

  async function cacheRequest(sourceUrl) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceUrl));
    const hash = Array.from(new Uint8Array(digest)).slice(0, 16).map((value) => value.toString(16).padStart(2, '0')).join('');
    return new Request(new URL(`/__slevao_home_leaflet_v5__/${hash}`, location.origin));
  }

  async function cachedCover(sourceUrl) {
    if (!('caches' in window) || !crypto?.subtle) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(await cacheRequest(sourceUrl));
      return response?.ok ? response.blob() : null;
    } catch {
      return null;
    }
  }

  async function saveCover(sourceUrl, blob) {
    if (!('caches' in window) || !crypto?.subtle) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(await cacheRequest(sourceUrl), new Response(blob, { headers: { 'content-type': blob.type || 'image/webp' } }));
    } catch {}
  }

  async function canvasBlob(canvas) {
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (webp) return webp;
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Obrázek titulní strany se nepodařilo vytvořit.');
    return png;
  }

  async function renderFirstPage(documentBlob) {
    const bytes = new Uint8Array(await documentBlob.arrayBuffer());
    if (!isPdf(documentBlob, bytes)) {
      if (!String(documentBlob.type || '').startsWith('image/')) throw new Error('Leták není PDF ani obrázek.');
      return documentBlob;
    }
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: true }).promise;
    try {
      const page = await pdf.getPage(1);
      const natural = page.getViewport({ scale: 1 });
      const desiredWidth = Math.min(640, Math.max(360, window.innerWidth * 0.5));
      const viewport = page.getViewport({ scale: Math.min(2.2, desiredWidth / natural.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      return canvasBlob(canvas);
    } finally {
      await pdf.destroy();
    }
  }

  async function coverFor(leaflet) {
    const cached = await cachedCover(leaflet.preview_url);
    if (cached) return cached;
    const rendered = await renderFirstPage(await fetchDocument(leaflet.preview_url));
    saveCover(leaflet.preview_url, rendered);
    return rendered;
  }

  function logoMarkup(leaflet) {
    if (leaflet.logo_url) {
      return `<img class="leafletCardLogo" src="${esc(leaflet.logo_url)}" alt="Logo ${esc(leaflet.store_name)}" loading="eager" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'leafletCardLogoFallback',textContent:'%'}))">`;
    }
    return '<span class="leafletCardLogoFallback" aria-hidden="true">%</span>';
  }

  function validityText(leaflet) {
    if (leaflet.valid_from && leaflet.valid_to) return `${formatDate(leaflet.valid_from)}–${formatDate(leaflet.valid_to)}`;
    if (leaflet.valid_to) return `do ${formatDate(leaflet.valid_to)}`;
    return 'aktuální vydání';
  }

  function cardMarkup(leaflet, objectUrl) {
    return `<article class="leafletCard" data-direct-leaflet-card="1" data-store-slug="${esc(leaflet.store_slug)}">
      <a class="leafletCover leafletCoverLink" href="${esc(leaflet.store_slug)}.html" aria-label="Otevřít leták ${esc(leaflet.store_name)}">
        <img class="leafletFrontPage" src="${esc(objectUrl)}" alt="Titulní strana aktuálního letáku ${esc(leaflet.store_name)}" loading="eager" decoding="async">
        <span class="leafletCurrentBadge">Aktuální leták</span>
      </a>
      <div class="leafletBody">
        <div class="leafletStoreIdentity">${logoMarkup(leaflet)}<h3>${esc(leaflet.store_name)}</h3></div>
        <div class="leafletMeta"><span>Titulní strana</span><span>${esc(validityText(leaflet))}</span></div>
        <div class="leafletAction"><button class="textButton" type="button" data-store="${esc(leaflet.store_slug)}">Zobrazit akce</button><a href="${esc(leaflet.store_slug)}.html">Prolistovat ↗</a></div>
      </div>
    </article>`;
  }

  function skeletonMarkup(index) {
    return `<article class="leafletCard leafletFastSkeleton" data-fast-skeleton="${index}"><div class="leafletCover"></div><div class="leafletBody"><div class="leafletSkeletonLine wide"></div><div class="leafletSkeletonLine"></div><div class="leafletSkeletonLine short"></div></div></article>`;
  }

  function ensureQuietSkeletons(grid) {
    if (grid.querySelector('.leafletCard[data-direct-leaflet-card="1"]')) return;
    const existingUseful = grid.querySelector('.leafletCard:not([data-fast-skeleton])');
    if (existingUseful) return;
    grid.innerHTML = [0, 1, 2].map(skeletonMarkup).join('');
  }

  async function resolveCachedCards(leaflets) {
    const resolved = [];
    for (const leaflet of leaflets) {
      const blob = await cachedCover(leaflet.preview_url);
      if (!blob) continue;
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.add(objectUrl);
      resolved.push({ leaflet, objectUrl });
    }
    return resolved;
  }

  function commitCards(grid, cards, state = 'ready') {
    if (!cards.length) return;
    grid.innerHTML = cards.map(({ leaflet, objectUrl }) => cardMarkup(leaflet, objectUrl)).join('');
    grid.dataset.directLeafletRenderer = state;
  }

  async function renderFreshProgressively(grid, leaflets, generation, seedCards = []) {
    const results = new Array(leaflets.length);
    const seedBySlug = new Map(seedCards.map((item) => [item.leaflet.store_slug, item]));
    leaflets.forEach((leaflet, index) => {
      if (seedBySlug.has(leaflet.store_slug)) results[index] = seedBySlug.get(leaflet.store_slug);
    });

    let cursor = 0;
    let firstCommitDone = seedCards.length > 0;
    const workers = Array.from({ length: Math.min(COVER_CONCURRENCY, leaflets.length) }, async () => {
      while (cursor < leaflets.length) {
        const index = cursor++;
        if (results[index]) continue;
        const leaflet = leaflets[index];
        try {
          const cover = await coverFor(leaflet);
          if (generation !== renderGeneration) return;
          const objectUrl = URL.createObjectURL(cover);
          objectUrls.add(objectUrl);
          results[index] = { leaflet, objectUrl };

          const ready = results.filter(Boolean);
          if (!firstCommitDone && ready.length >= 2) {
            commitCards(grid, ready, 'partial');
            firstCommitDone = true;
          } else if (firstCommitDone && ready.length < leaflets.length) {
            commitCards(grid, ready, 'partial');
          }
        } catch (error) {
          console.debug('Náhled letáku přeskočen:', leaflet.store_slug, error);
        }
      }
    });

    await Promise.all(workers);
    if (generation !== renderGeneration) return [];
    const finalCards = results.filter(Boolean);
    if (finalCards.length) commitCards(grid, finalCards, 'ready');
    return finalCards;
  }

  async function renderSection(forceReload = false) {
    if (rendering && !forceReload) return;
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    rendering = true;
    const generation = ++renderGeneration;
    grid.dataset.directLeafletRenderer = 'warming';
    ensureQuietSkeletons(grid);

    try {
      const cachedMeta = !forceReload ? readMetaCache() : null;
      let cachedCards = [];
      if (cachedMeta?.leaflets?.length) {
        cachedCards = await resolveCachedCards(cachedMeta.leaflets);
        if (generation !== renderGeneration) return;
        if (cachedCards.length) commitCards(grid, cachedCards, 'cached');
      }

      const cacheFresh = cachedMeta && Date.now() - Number(cachedMeta.savedAt || 0) < META_CACHE_TTL;
      const freshLeaflets = cacheFresh ? cachedMeta.leaflets : await loadFreshLeaflets();
      if (generation !== renderGeneration) return;
      if (!freshLeaflets.length) throw new Error('Nebyl nalezen žádný aktuální leták.');

      scheduleFreshCacheRefresh(cacheFresh ? cachedMeta : { savedAt: Date.now() });
      await renderFreshProgressively(grid, freshLeaflets, generation, cachedCards);
    } catch (error) {
      console.error('Načtení titulních stran selhalo:', error);
      if (!grid.querySelector('.leafletCard[data-direct-leaflet-card="1"]')) {
        grid.dataset.directLeafletRenderer = 'error';
      }
    } finally {
      rendering = false;
    }
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    renderSection(false);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || rendering) return;
    const cachedMeta = readMetaCache();
    const savedAt = Number(cachedMeta?.savedAt || 0);
    if (!savedAt || Date.now() - savedAt >= META_CACHE_TTL) renderSection(true);
    else scheduleFreshCacheRefresh(cachedMeta);
  });

  window.addEventListener('pagehide', () => {
    window.clearTimeout(cacheRefreshTimer);
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();