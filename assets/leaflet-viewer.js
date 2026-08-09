const SUPABASE_HOST = 'uhampjdqjxmbhaptgitn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
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

const params = new URLSearchParams(location.search);
const source = params.get('src') || '';
const store = params.get('store') || 'Obchod';
const title = params.get('title') || 'Aktuální leták';
const pagesRoot = document.getElementById('viewerPages');
const statusNode = document.getElementById('viewerStatus');
const countNode = document.getElementById('viewerPageCount');
const titleNode = document.getElementById('viewerTitle');
const storeNode = document.getElementById('viewerStore');

if (titleNode) titleNode.textContent = title;
if (storeNode) storeNode.textContent = store;
document.title = `${title} – ${store} | Slevao.cz`;

document.getElementById('viewerBack')?.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'letaky.html';
});

function safeHttpsUrl(value) {
  try {
    const url = new URL(value, location.href);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDocument(urlString) {
  const url = safeHttpsUrl(urlString);
  if (!url) throw new Error('Adresa letáku není platná.');

  const headers = { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' };
  if (url.hostname === SUPABASE_HOST) headers.apikey = SUPABASE_KEY;

  let response = await fetchWithTimeout(url, { headers, cache: 'default' });
  if (!response.ok) throw new Error(`Leták se nepodařilo načíst (${response.status}).`);

  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) {
    const payload = await response.json();
    const redirected = safeHttpsUrl(String(payload?.url || ''));
    if (!redirected) throw new Error(payload?.error || 'Zdroj nevrátil platný dokument.');
    response = await fetchWithTimeout(redirected, {
      headers: { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
      cache: 'default',
    });
    if (!response.ok) throw new Error(`Soubor letáku se nepodařilo načíst (${response.status}).`);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error('Leták je prázdný.');
  return blob;
}

function hasPdfMagic(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function hasPngMagic(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function hasJpegMagic(bytes) {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function hasWebpMagic(bytes) {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

async function loadPdfjs() {
  let lastError = null;
  for (const sourceDef of PDF_SOURCES) {
    try {
      const module = await import(sourceDef.module);
      module.GlobalWorkerOptions.workerSrc = sourceDef.worker;
      return module;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Prohlížeč neumí zobrazit PDF leták.');
}

function showError(message) {
  statusNode.textContent = 'Leták se nepodařilo otevřít';
  countNode.textContent = 'Chyba';
  pagesRoot.innerHTML = `<div class="viewerError"><strong>Leták se nepodařilo zobrazit</strong><p></p><a href="letaky.html">Zpět na všechny letáky</a></div>`;
  pagesRoot.querySelector('.viewerError p').textContent = message;
}

function showImage(blob) {
  const url = URL.createObjectURL(blob);
  pagesRoot.innerHTML = '<div class="viewerImageWrap"><img alt="Aktuální leták"></div>';
  pagesRoot.querySelector('img').src = url;
  statusNode.textContent = 'Leták je otevřený';
  countNode.textContent = '1 strana';
  window.addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true });
}

async function showPdf(blob) {
  statusNode.textContent = 'Připravuji stránky letáku…';
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: true });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;

  countNode.textContent = total === 1 ? '1 strana' : `${total} stran`;
  statusNode.textContent = 'Leták je otevřený – posouvej dolů';
  pagesRoot.innerHTML = Array.from({ length: total }, (_, index) => (
    `<section class="viewerPage" data-page="${index + 1}"><div class="viewerSkeleton">Načítám stranu ${index + 1}</div><span class="viewerPageNumber">${index + 1} / ${total}</span></section>`
  )).join('');

  const rendering = new Map();
  const rendered = new Set();

  async function renderPage(slot) {
    const pageNumber = Number(slot?.dataset?.page || 0);
    if (!pageNumber || rendered.has(pageNumber)) return;
    if (rendering.has(pageNumber)) return rendering.get(pageNumber);

    const promise = (async () => {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const available = Math.max(260, Math.min(980, document.documentElement.clientWidth - (document.documentElement.clientWidth <= 800 ? 14 : 36)));
      const cssScale = available / base.width;
      const outputScale = Math.min(1.65, Math.max(1, window.devicePixelRatio || 1));
      const viewport = page.getViewport({ scale: cssScale * outputScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
      canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Stranu letáku nelze vykreslit.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      slot.querySelector('.viewerSkeleton')?.remove();
      slot.prepend(canvas);
      rendered.add(pageNumber);
    })().catch((error) => {
      const skeleton = slot.querySelector('.viewerSkeleton');
      if (skeleton) skeleton.textContent = 'Stranu se nepodařilo načíst';
      console.warn('Leaflet page render failed:', pageNumber, error);
    }).finally(() => rendering.delete(pageNumber));

    rendering.set(pageNumber, promise);
    return promise;
  }

  const slots = [...pagesRoot.querySelectorAll('.viewerPage')];
  await renderPage(slots[0]);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        renderPage(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '900px 0px' });
    slots.slice(1).forEach((slot) => observer.observe(slot));
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  } else {
    for (const slot of slots.slice(1)) await renderPage(slot);
  }

  window.addEventListener('pagehide', () => {
    try { pdf.destroy(); } catch {}
  }, { once: true });
}

async function boot() {
  try {
    if (!source) throw new Error('Chybí adresa letáku.');
    const blob = await fetchDocument(source);
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (String(blob.type || '').toLowerCase().includes('pdf') || hasPdfMagic(head)) {
      await showPdf(blob);
      return;
    }
    if (String(blob.type || '').toLowerCase().startsWith('image/') || hasPngMagic(head) || hasJpegMagic(head) || hasWebpMagic(head)) {
      showImage(blob);
      return;
    }
    throw new Error('Zdroj neposlal PDF ani obrázek letáku.');
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Neznámá chyba.');
  }
}

boot();
