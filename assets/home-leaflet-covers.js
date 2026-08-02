(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const TODAY = new Date().toISOString().slice(0, 10);
  const MAX_CARDS = 12;
  const STORE_BATCH_SIZE = 8;
  const COVER_CONCURRENCY = 3;
  const CACHE_NAME = 'slevao-homepage-leaflet-covers-v4';
  const PRIORITY_SLUGS = [
    'tesco', 'penny', 'makro', 'kaufland', 'lidl', 'albert', 'billa', 'globus',
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
  let leafletDataPromise = null;
  let renderGeneration = 0;
  let observerWriting = false;
  let scheduledRender = 0;
  const objectUrls = new Set();

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function formatDate(value) {
    if (!value) return '';
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric', month: 'numeric', year: 'numeric',
    }).format(parsed);
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

  async function rest(path, params, range = '') {
    const query = new URLSearchParams(params);
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
      headers: {
        apikey: SUPABASE_KEY,
        ...(range ? { Range: range } : {}),
      },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Databáze vrátila HTTP ${response.status}.`);
    return response.json();
  }

  async function activeStores() {
    const stores = await rest('stores', {
      select: 'id,slug,name,logo_url,sort_order',
      is_active: 'eq.true',
      order: 'sort_order.asc.nullslast,name.asc',
    });

    let activeIds = null;
    try {
      activeIds = new Set();
      for (let from = 0; from < 5000; from += 1000) {
        const rows = await rest('offers', {
          select: 'store_id',
          status: 'eq.published',
          valid_from: `lte.${TODAY}`,
          valid_to: `gte.${TODAY}`,
        }, `${from}-${from + 999}`);
        rows.forEach((row) => row.store_id && activeIds.add(String(row.store_id)));
        if (rows.length < 1000) break;
      }
    } catch (error) {
      console.warn('Aktivní obchody se nepodařilo omezit podle nabídek:', error);
      activeIds = null;
    }

    const priority = new Map(PRIORITY_SLUGS.map((slug, index) => [slug, index]));
    return stores
      .filter((store) => store?.slug && (!activeIds || activeIds.has(String(store.id))))
      .sort((a, b) => {
        const aPriority = priority.has(a.slug) ? priority.get(a.slug) : 999;
        const bPriority = priority.has(b.slug) ? priority.get(b.slug) : 999;
        return aPriority - bPriority
          || Number(a.sort_order ?? 9999) - Number(b.sort_order ?? 9999)
          || String(a.name || '').localeCompare(String(b.name || ''), 'cs');
      });
  }

  function currentLeaflet(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((leaflet) => leaflet?.preview_url)
      .filter((leaflet) => !leaflet.valid_from || leaflet.valid_from <= TODAY)
      .filter((leaflet) => !leaflet.valid_to || leaflet.valid_to >= TODAY)
      .sort((a, b) => {
        const aPriority = a.key === 'hypermarket' ? 0 : a.key === 'supermarket' ? 1 : 2;
        const bPriority = b.key === 'hypermarket' ? 0 : b.key === 'supermarket' ? 1 : 2;
        return aPriority - bPriority
          || String(a.valid_to || '9999-12-31').localeCompare(String(b.valid_to || '9999-12-31'));
      })[0] || null;
  }

  async function storeLeaflet(store) {
    const endpoint = `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(store.slug)}&source=homepage-v4`;
    const response = await fetchWithTimeout(endpoint, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
    }, 8000);
    if (!response.ok) throw new Error(`${store.slug}: HTTP ${response.status}`);
    const payload = await response.json();
    const leaflet = currentLeaflet(payload?.leaflets);
    if (!leaflet) throw new Error(`${store.slug}: žádný aktuální dokument`);
    return {
      store_slug: store.slug,
      store_name: store.name,
      logo_url: leaflet.logo_url || store.logo_url || LOCAL_LOGOS[store.slug] || null,
      title: leaflet.title || 'Aktuální leták',
      valid_from: leaflet.valid_from || null,
      valid_to: leaflet.valid_to || null,
      preview_url: String(leaflet.preview_url),
    };
  }

  async function loadLeaflets() {
    const stores = await activeStores();
    const output = [];
    const seen = new Set();

    for (let offset = 0; offset < stores.length && output.length < MAX_CARDS; offset += STORE_BATCH_SIZE) {
      const batch = stores.slice(offset, offset + STORE_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(storeLeaflet));
      results.forEach((result) => {
        if (result.status !== 'fulfilled') {
          console.debug('Leták obchodu přeskočen:', result.reason);
          return;
        }
        if (seen.has(result.value.store_slug)) return;
        seen.add(result.value.store_slug);
        output.push(result.value);
      });
    }

    return output.slice(0, MAX_CARDS);
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
            console.warn('PDF.js zdroj selhal:', source.module, error);
          }
        }
        throw lastError || new Error('PDF.js není dostupné.');
      })();
    }
    return pdfjsPromise;
  }

  function isPdf(blob, bytes) {
    if (String(blob.type || '').toLowerCase().includes('pdf')) return true;
    return bytes.length >= 4
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46;
  }

  async function fetchDocument(url) {
    let response = await fetchWithTimeout(url, {
      headers: {
        apikey: SUPABASE_KEY,
        accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8',
      },
      cache: 'no-store',
    }, 26000);
    if (!response.ok) throw new Error(`Dokument vrátil HTTP ${response.status}.`);

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const redirectedUrl = String(payload?.url || '');
      if (!redirectedUrl.startsWith('https://')) {
        throw new Error(payload?.error || 'Leták nevrátil platný dokument.');
      }
      response = await fetchWithTimeout(redirectedUrl, {
        headers: { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
        cache: 'no-store',
      }, 26000);
      if (!response.ok) throw new Error(`Soubor vrátil HTTP ${response.status}.`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('Dokument letáku je prázdný.');
    return blob;
  }

  async function cacheRequest(sourceUrl) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceUrl));
    const hash = Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return new Request(new URL(`/__slevao_home_leaflet_v4__/${hash}`, location.origin));
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
      await cache.put(await cacheRequest(sourceUrl), new Response(blob, {
        headers: {
          'content-type': blob.type || 'image/webp',
          'cache-control': 'public,max-age=604800',
        },
      }));
    } catch {
      // Cache nesmí zablokovat zobrazení.
    }
  }

  async function canvasBlob(canvas) {
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (webp) return webp;
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Obrázek titulní strany se nepodařilo vytvořit.');
    return png;
  }

  async function renderFirstPage(documentBlob) {
    const bytes = new Uint8Array(await documentBlob.arrayBuffer());
    if (!isPdf(documentBlob, bytes)) {
      if (!String(documentBlob.type || '').startsWith('image/')) {
        throw new Error('Leták není PDF ani obrázek.');
      }
      return documentBlob;
    }

    const pdfjs = await loadPdfjs();
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useWorkerFetch: true,
    });
    const pdf = await loadingTask.promise;
    try {
      const page = await pdf.getPage(1);
      const natural = page.getViewport({ scale: 1 });
      const desiredWidth = Math.min(720, Math.max(420, window.innerWidth * 0.55));
      const viewport = page.getViewport({ scale: Math.min(2.5, desiredWidth / natural.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Prohlížeč neumí vykreslit PDF.');
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
    await saveCover(leaflet.preview_url, rendered);
    return rendered;
  }

  async function mapWithConcurrency(items, worker, concurrency) {
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          results[index] = { error, leaflet: items[index] };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
    return results;
  }

  function logoMarkup(leaflet) {
    if (leaflet.logo_url) {
      return `<img class="leafletCardLogo" src="${esc(leaflet.logo_url)}" alt="Logo ${esc(leaflet.store_name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'leafletCardLogoFallback',textContent:'%' }))">`;
    }
    return '<span class="leafletCardLogoFallback" aria-hidden="true">%</span>';
  }

  function cardMarkup(leaflet, objectUrl) {
    const validity = leaflet.valid_from && leaflet.valid_to
      ? `${formatDate(leaflet.valid_from)}–${formatDate(leaflet.valid_to)}`
      : leaflet.valid_to
        ? `do ${formatDate(leaflet.valid_to)}`
        : 'aktuální vydání';

    return `<article class="leafletCard" data-direct-leaflet-card="1">
      <a class="leafletCover leafletCoverLink" href="${esc(leaflet.store_slug)}.html" aria-label="Otevřít leták ${esc(leaflet.store_name)}">
        <img class="leafletFrontPage" src="${esc(objectUrl)}" alt="Titulní strana aktuálního letáku ${esc(leaflet.store_name)}">
        <span class="leafletCurrentBadge">Aktuální leták</span>
      </a>
      <div class="leafletBody">
        <div class="leafletStoreIdentity">${logoMarkup(leaflet)}<h3>${esc(leaflet.store_name)}</h3></div>
        <div class="leafletMeta"><span>Titulní strana</span><span>${esc(validity)}</span></div>
        <div class="leafletAction">
          <button class="textButton" type="button" data-store="${esc(leaflet.store_slug)}">Zobrazit akce</button>
          <a href="${esc(leaflet.store_slug)}.html">Prolistovat ↗</a>
        </div>
      </div>
    </article>`;
  }

  function fallbackCardMarkup(leaflet) {
    const validity = leaflet.valid_to ? `do ${formatDate(leaflet.valid_to)}` : 'aktuální vydání';
    return `<article class="leafletCard" data-direct-leaflet-card="1" data-cover-fallback="1">
      <a class="leafletCover leafletCoverLink" href="${esc(leaflet.store_slug)}.html">
        <div class="leafletFallbackCover">${logoMarkup(leaflet)}<strong>Aktuální leták</strong><small>Náhled titulní strany se nepodařilo vytvořit</small></div>
      </a>
      <div class="leafletBody">
        <div class="leafletStoreIdentity">${logoMarkup(leaflet)}<h3>${esc(leaflet.store_name)}</h3></div>
        <div class="leafletMeta"><span>Leták</span><span>${esc(validity)}</span></div>
        <div class="leafletAction"><button class="textButton" type="button" data-store="${esc(leaflet.store_slug)}">Zobrazit akce</button><a href="${esc(leaflet.store_slug)}.html">Prolistovat ↗</a></div>
      </div>
    </article>`;
  }

  function errorMarkup(message) {
    return `<div class="emptyState"><strong>Aktuální letáky se nepodařilo načíst</strong><span>${esc(message)}</span><button class="primaryButton" id="reloadLeafletCovers" type="button">Načíst znovu</button></div>`;
  }

  async function renderSection(forceReload = false) {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    const generation = ++renderGeneration;

    observerWriting = true;
    grid.dataset.directLeafletRenderer = 'loading';
    grid.innerHTML = '<div class="loadingState"><span class="spinner"></span><strong>Načítám titulní strany letáků</strong><small>Kontroluji právě platná vydání obchodů.</small></div>';
    observerWriting = false;

    try {
      if (forceReload) leafletDataPromise = null;
      if (!leafletDataPromise) leafletDataPromise = loadLeaflets();
      const leaflets = await leafletDataPromise;
      if (generation !== renderGeneration) return;
      if (!leaflets.length) throw new Error('Ve veřejném feedu nebyl nalezen žádný aktuální leták.');

      const rendered = await mapWithConcurrency(leaflets, async (leaflet) => {
        const cover = await coverFor(leaflet);
        const objectUrl = URL.createObjectURL(cover);
        objectUrls.add(objectUrl);
        return { leaflet, objectUrl };
      }, COVER_CONCURRENCY);
      if (generation !== renderGeneration) return;

      const successful = rendered.filter((item) => item && !item.error && item.objectUrl);
      const failed = rendered.filter((item) => item?.error);
      if (!successful.length) {
        throw new Error('Prohlížeč nedokázal vykreslit první stránku žádného aktuálního letáku.');
      }

      observerWriting = true;
      grid.innerHTML = [
        ...successful.map(({ leaflet, objectUrl }) => cardMarkup(leaflet, objectUrl)),
        ...failed.slice(0, Math.max(0, MAX_CARDS - successful.length)).map(({ leaflet }) => fallbackCardMarkup(leaflet)),
      ].join('');
      grid.dataset.directLeafletRenderer = 'ready';
      observerWriting = false;
    } catch (error) {
      if (generation !== renderGeneration) return;
      console.error('Načtení titulních stran selhalo:', error);
      observerWriting = true;
      grid.innerHTML = errorMarkup(error instanceof Error ? error.message : 'Neznámá chyba.');
      grid.dataset.directLeafletRenderer = 'error';
      observerWriting = false;
      document.getElementById('reloadLeafletCovers')?.addEventListener('click', () => renderSection(true), { once: true });
    }
  }

  function scheduleRender(forceReload = false) {
    window.clearTimeout(scheduledRender);
    scheduledRender = window.setTimeout(() => renderSection(forceReload), 20);
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;

    const observer = new MutationObserver(() => {
      if (observerWriting) return;
      const foreignCard = grid.querySelector('.leafletCard:not([data-direct-leaflet-card="1"])');
      if (foreignCard) scheduleRender(false);
    });
    observer.observe(grid, { childList: true });
    scheduleRender(false);
  }

  window.addEventListener('pagehide', () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
