(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FEED_URL = `${SUPABASE_URL}/functions/v1/homepage-leaflet-feed?limit=12`;
  const CACHE_NAME = 'slevao-homepage-leaflet-covers-v3';
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
  const MAX_CONCURRENT = 3;

  let pdfjsPromise = null;
  let renderGeneration = 0;
  const objectUrls = new Set();

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function formatDate(value) {
    if (!value) return '';
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(parsed);
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 22000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
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
            console.warn('PDF.js zdroj se nepodařilo načíst:', source.module, error);
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
    });

    if (!response.ok) throw new Error(`Dokument letáku vrátil HTTP ${response.status}.`);

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const redirectedUrl = String(payload?.url || '');
      if (!redirectedUrl.startsWith('https://')) {
        throw new Error(payload?.error || 'Leták nevrátil dokument.');
      }
      response = await fetchWithTimeout(redirectedUrl, {
        headers: { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Soubor letáku vrátil HTTP ${response.status}.`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('Dokument letáku je prázdný.');
    return blob;
  }

  async function cacheRequest(sourceUrl) {
    const encoded = new TextEncoder().encode(sourceUrl);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    const hash = Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return new Request(new URL(`/__slevao_home_leaflet__/${hash}`, location.origin));
  }

  async function readCachedCover(sourceUrl) {
    if (!('caches' in window) || !crypto?.subtle) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(await cacheRequest(sourceUrl));
      return response?.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  async function saveCachedCover(sourceUrl, blob) {
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
      // Omezené úložiště nesmí zablokovat sekci letáků.
    }
  }

  async function canvasToBlob(canvas) {
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (webp) return webp;
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Titulní stranu se nepodařilo převést na obrázek.');
    return png;
  }

  async function renderFirstPage(documentBlob) {
    const bytes = new Uint8Array(await documentBlob.arrayBuffer());
    if (!isPdf(documentBlob, bytes)) {
      if (!String(documentBlob.type || '').startsWith('image/')) {
        throw new Error('Dokument není PDF ani obrázek.');
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
      const baseViewport = page.getViewport({ scale: 1 });
      const desiredWidth = Math.min(720, Math.max(430, window.innerWidth * 0.55));
      const scale = Math.min(2.5, desiredWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Prohlížeč neumí vykreslit titulní stranu.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;
      return await canvasToBlob(canvas);
    } finally {
      await pdf.destroy();
    }
  }

  async function coverFor(leaflet) {
    const cached = await readCachedCover(leaflet.preview_url);
    if (cached) return cached;
    const rendered = await renderFirstPage(await fetchDocument(leaflet.preview_url));
    await saveCachedCover(leaflet.preview_url, rendered);
    return rendered;
  }

  function logoMarkup(leaflet) {
    if (leaflet.logo_url) {
      return `<img class="leafletCardLogo" src="${esc(leaflet.logo_url)}" alt="Logo ${esc(leaflet.store_name)}" loading="lazy">`;
    }
    return '<span class="leafletCardLogoFallback" aria-hidden="true">%</span>';
  }

  function cardMarkup(leaflet, coverUrl) {
    const validity = leaflet.valid_from && leaflet.valid_to
      ? `${formatDate(leaflet.valid_from)}–${formatDate(leaflet.valid_to)}`
      : leaflet.valid_to
        ? `do ${formatDate(leaflet.valid_to)}`
        : 'aktuální vydání';

    return `<article class="leafletCard" data-direct-leaflet-card="1">
      <a class="leafletCover leafletCoverLink" href="${esc(leaflet.store_slug)}.html#leafletsSection" aria-label="Otevřít aktuální leták ${esc(leaflet.store_name)}">
        <img class="leafletFrontPage" src="${esc(coverUrl)}" alt="Titulní strana aktuálního letáku ${esc(leaflet.store_name)}">
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

  function errorMarkup(message) {
    return `<div class="emptyState">
      <strong>Aktuální letáky se nepodařilo načíst</strong>
      <span>${esc(message)}</span>
      <button class="primaryButton" id="reloadLeafletCovers" type="button">Načíst znovu</button>
    </div>`;
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
          results[index] = { error };
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
    return results;
  }

  async function fetchLeaflets() {
    const response = await fetchWithTimeout(FEED_URL, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
    }, 18000);
    if (!response.ok) throw new Error(`Feed letáků vrátil HTTP ${response.status}.`);
    const payload = await response.json();
    if (!payload?.ok || !Array.isArray(payload.leaflets)) {
      throw new Error(payload?.error || 'Feed letáků nevrátil platná data.');
    }
    return payload.leaflets.filter((leaflet) => (
      leaflet?.store_slug
      && leaflet?.store_name
      && leaflet?.preview_url
    ));
  }

  async function renderSection() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;

    const generation = ++renderGeneration;
    grid.dataset.directLeafletRenderer = 'loading';
    grid.innerHTML = `<div class="loadingState">
      <span class="spinner"></span>
      <strong>Načítám titulní strany letáků</strong>
      <small>Zobrazuji pouze právě platná vydání.</small>
    </div>`;

    try {
      const leaflets = await fetchLeaflets();
      if (generation !== renderGeneration) return;
      if (!leaflets.length) {
        grid.innerHTML = '<div class="emptyState"><strong>Žádný aktuální leták není dostupný</strong><span>Jakmile bude nové vydání zpracované, zobrazí se zde automaticky.</span></div>';
        grid.dataset.directLeafletRenderer = 'ready';
        return;
      }

      const rendered = await mapWithConcurrency(leaflets, async (leaflet) => {
        const cover = await coverFor(leaflet);
        const objectUrl = URL.createObjectURL(cover);
        objectUrls.add(objectUrl);
        return { leaflet, objectUrl };
      }, MAX_CONCURRENT);

      if (generation !== renderGeneration) return;
      const successful = rendered.filter((item) => item && !item.error && item.objectUrl);
      if (!successful.length) {
        throw new Error('První stránky PDF se v tomto prohlížeči nepodařilo vykreslit.');
      }

      grid.innerHTML = successful
        .map(({ leaflet, objectUrl }) => cardMarkup(leaflet, objectUrl))
        .join('');
      grid.dataset.directLeafletRenderer = 'ready';
    } catch (error) {
      if (generation !== renderGeneration) return;
      console.error('Homepage leaflet renderer failed:', error);
      grid.innerHTML = errorMarkup(error instanceof Error ? error.message : 'Neznámá chyba.');
      grid.dataset.directLeafletRenderer = 'error';
      document.getElementById('reloadLeafletCovers')?.addEventListener('click', renderSection, { once: true });
    }
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;

    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (grid.dataset.directLeafletRenderer) return;
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        renderSection();
      }, 0);
    });
    observer.observe(grid, { childList: true });

    window.setTimeout(renderSection, 0);
  }

  window.addEventListener('pagehide', () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();