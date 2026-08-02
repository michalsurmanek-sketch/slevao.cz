(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PDFJS_VERSION = '6.1.200';
  const PDFJS_MODULE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
  const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  const COVER_CACHE = 'slevao-current-leaflet-covers-v1';
  const TODAY = new Date().toISOString().slice(0, 10);
  const MAX_CONCURRENT = 3;

  const processedCards = new WeakSet();
  const coverPromises = new Map();
  const objectUrls = new Set();
  const queue = [];
  let activeTasks = 0;
  let pdfjsPromise = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric', month: 'numeric', year: 'numeric',
    }).format(new Date(`${value}T12:00:00`));
  }

  function cardSlug(card) {
    const dataSlug = card.querySelector('[data-store]')?.dataset.store;
    if (dataSlug && dataSlug !== 'all') return dataSlug;
    const href = card.querySelector('.leafletAction a[href$=".html"]')?.getAttribute('href') || '';
    return decodeURIComponent(href.replace(/^.*\//, '').replace(/\.html(?:[?#].*)?$/i, ''));
  }

  function storeName(card) {
    return card.querySelector('.leafletBody h3')?.textContent?.trim() || 'obchodu';
  }

  function setLoading(card) {
    const cover = card.querySelector('.leafletCover');
    if (!cover) return;
    card.dataset.leafletCoverState = 'loading';
    cover.innerHTML = `
      <span class="leafletCoverLoader" aria-hidden="true"></span>
      <span class="leafletCoverLoadingText">Načítám titulní stranu…</span>`;
  }

  function currentLeaflet(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((leaflet) => leaflet?.preview_url)
      .filter((leaflet) => !leaflet.valid_from || leaflet.valid_from <= TODAY)
      .filter((leaflet) => !leaflet.valid_to || leaflet.valid_to >= TODAY)
      .sort((a, b) => String(a.valid_to || '9999-12-31').localeCompare(String(b.valid_to || '9999-12-31')))[0] || null;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 16000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fetchLeaflet(slug) {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(slug)}&source=homepage-cover-v1`,
      { headers: { apikey: SUPABASE_KEY }, cache: 'no-store' },
      10000,
    );
    if (!response.ok) throw new Error(`Feed letáku vrátil HTTP ${response.status}.`);
    const payload = await response.json();
    const leaflet = currentLeaflet(payload?.leaflets);
    if (!leaflet) throw new Error('Obchod nemá dostupný aktuální leták s náhledem.');
    return leaflet;
  }

  async function fetchLeafletBlob(previewUrl) {
    let response = await fetchWithTimeout(previewUrl, {
      headers: { apikey: SUPABASE_KEY, accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
      cache: 'no-store',
    }, 26000);
    if (!response.ok) throw new Error(`Dokument letáku vrátil HTTP ${response.status}.`);

    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/json')) {
      const payload = await response.json();
      const signedUrl = String(payload?.url || '');
      if (!signedUrl.startsWith(`${SUPABASE_URL}/storage/v1/object/sign/`)) {
        throw new Error(payload?.error || 'Leták nevrátil platný dokument.');
      }
      response = await fetchWithTimeout(signedUrl, {
        headers: { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
        cache: 'no-store',
      }, 26000);
      if (!response.ok) throw new Error(`Soubor letáku vrátil HTTP ${response.status}.`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error('Stažený leták je prázdný.');
    return blob;
  }

  async function cacheKey(sourceUrl) {
    const bytes = new TextEncoder().encode(sourceUrl);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].slice(0, 16).map((value) => value.toString(16).padStart(2, '0')).join('');
    return new Request(new URL(`/__slevao_leaflet_cover__/${hash}`, location.origin));
  }

  async function cachedCover(sourceUrl) {
    if (!('caches' in window) || !crypto?.subtle) return null;
    try {
      const cache = await caches.open(COVER_CACHE);
      const response = await cache.match(await cacheKey(sourceUrl));
      return response?.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  async function saveCover(sourceUrl, blob) {
    if (!('caches' in window) || !crypto?.subtle) return;
    try {
      const cache = await caches.open(COVER_CACHE);
      await cache.put(await cacheKey(sourceUrl), new Response(blob, {
        headers: { 'content-type': blob.type || 'image/webp', 'cache-control': 'public,max-age=604800' },
      }));
    } catch {
      // Soukromý režim nebo omezené úložiště nesmí zablokovat vykreslení.
    }
  }

  async function pdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(PDFJS_MODULE).then((module) => {
        module.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return module;
      });
    }
    return pdfjsPromise;
  }

  function isPdf(blob, bytes) {
    if (String(blob.type).toLowerCase().includes('pdf')) return true;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }

  async function canvasBlob(canvas) {
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (webp) return webp;
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Náhled titulní strany se nepodařilo vytvořit.');
    return png;
  }

  async function renderFirstPage(documentBlob) {
    const bytes = new Uint8Array(await documentBlob.arrayBuffer());
    if (!isPdf(documentBlob, bytes)) {
      if (!String(documentBlob.type).startsWith('image/')) {
        throw new Error('Leták není podporovaný PDF ani obrázek.');
      }
      return documentBlob;
    }

    const library = await pdfjs();
    const task = library.getDocument({ data: bytes, isEvalSupported: false });
    const pdfDocument = await task.promise;
    try {
      const page = await pdfDocument.getPage(1);
      const natural = page.getViewport({ scale: 1 });
      const targetWidth = Math.min(620, Math.max(360, window.innerWidth * 0.45));
      const scale = Math.min(2.25, targetWidth / natural.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Prohlížeč neumí vytvořit náhled letáku.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      return await canvasBlob(canvas);
    } finally {
      await pdfDocument.destroy();
    }
  }

  async function coverFor(slug) {
    if (!coverPromises.has(slug)) {
      coverPromises.set(slug, (async () => {
        const leaflet = await fetchLeaflet(slug);
        let cover = await cachedCover(leaflet.preview_url);
        if (!cover) {
          cover = await renderFirstPage(await fetchLeafletBlob(leaflet.preview_url));
          await saveCover(leaflet.preview_url, cover);
        }
        return { leaflet, cover };
      })());
    }
    return coverPromises.get(slug);
  }

  function applyCover(card, result) {
    const cover = card.querySelector('.leafletCover');
    if (!cover) return;
    const name = storeName(card);
    const objectUrl = URL.createObjectURL(result.cover);
    objectUrls.add(objectUrl);
    cover.innerHTML = `
      <img class="leafletFrontPage" src="${esc(objectUrl)}" alt="Titulní strana aktuálního letáku ${esc(name)}">
      <span class="leafletCurrentBadge">Aktuální leták</span>`;
    card.dataset.leafletCoverState = 'ready';

    const meta = card.querySelector('.leafletMeta');
    if (meta) {
      const validity = result.leaflet.valid_from && result.leaflet.valid_to
        ? `${formatDate(result.leaflet.valid_from)}–${formatDate(result.leaflet.valid_to)}`
        : result.leaflet.valid_to ? `do ${formatDate(result.leaflet.valid_to)}` : 'platnost v detailu';
      meta.innerHTML = `<span>Titulní strana</span><span>${esc(validity)}</span>`;
    }
  }

  function ensureSectionState() {
    const grid = document.getElementById('leafletGrid');
    if (!grid || grid.querySelector('.leafletCard')) return;
    if (activeTasks || queue.length || grid.querySelector('.skeleton')) return;
    grid.innerHTML = '<div class="emptyState"><strong>Aktuální titulní strany se připravují</strong><span>Zobrazíme pouze obchody, u kterých máme dostupný platný leták.</span></div>';
  }

  async function decorate(card) {
    const slug = cardSlug(card);
    if (!slug) {
      card.remove();
      return;
    }
    setLoading(card);
    try {
      applyCover(card, await coverFor(slug));
    } catch (error) {
      console.warn(`Titulní strana letáku ${slug} není dostupná:`, error);
      card.remove();
    }
  }

  function runQueue() {
    while (activeTasks < MAX_CONCURRENT && queue.length) {
      const task = queue.shift();
      activeTasks++;
      Promise.resolve().then(task).finally(() => {
        activeTasks--;
        runQueue();
        ensureSectionState();
      });
    }
  }

  function enqueue(task) {
    queue.push(task);
    runQueue();
  }

  function scan() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    grid.querySelectorAll('.leafletCard').forEach((card) => {
      if (processedCards.has(card)) return;
      processedCards.add(card);
      enqueue(() => decorate(card));
    });
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    const observer = new MutationObserver(scan);
    observer.observe(grid, { childList: true, subtree: false });
    scan();
  }

  window.addEventListener('pagehide', () => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
