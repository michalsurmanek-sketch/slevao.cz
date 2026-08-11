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
const mobileViewer = window.matchMedia('(max-width: 800px)').matches;

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

class DirectDocumentOpen extends Error {
  constructor(url) {
    super('Dokument se má otevřít přímo v prohlížeči.');
    this.name = 'DirectDocumentOpen';
    this.url = url;
  }
}

function isExternalDocument(url) {
  return Boolean(url && url.origin !== location.origin && url.hostname !== SUPABASE_HOST);
}

function openDocumentDirectly(value) {
  const url = safeHttpsUrl(value);
  if (!url) return false;
  statusNode.textContent = 'Otevírám leták…';
  countNode.textContent = '';
  pagesRoot.innerHTML = '<div class="viewerPage"><div class="viewerSpinner" aria-hidden="true"></div></div>';
  location.replace(url.href);
  return true;
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

  // Mobilní prohlížeče často blokují JS fetch cizího PDF kvůli CORS.
  // Navigace na samotný PDF dokument CORS nepodléhá, proto externí dokument
  // na mobilu otevřeme přímo a nesnažíme se z něj vyrábět Blob.
  if (mobileViewer && isExternalDocument(url)) throw new DirectDocumentOpen(url.href);

  const headers = { accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' };
  if (url.hostname === SUPABASE_HOST) headers.apikey = SUPABASE_KEY;

  let response = await fetchWithTimeout(url, { headers, cache: 'default' });
  if (!response.ok) throw new Error(`Leták se nepodařilo načíst (${response.status}).`);

  const type = String(response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('application/json')) {
    const payload = await response.json();
    const redirected = safeHttpsUrl(String(payload?.url || ''));
    if (!redirected) throw new Error(payload?.error || 'Zdroj nevrátil platný dokument.');

    // Typický případ: Supabase endpoint vrátí skutečné PDF na serveru obchodu.
    // Na mobilu ho otevřeme přímo, protože druhý cross-origin fetch je právě
    // zdrojem chyby "Failed to fetch".
    if (mobileViewer && isExternalDocument(redirected)) throw new DirectDocumentOpen(redirected.href);

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


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function isPepcoCollectionSource() {
  const url = safeHttpsUrl(source);
  return store.toLowerCase() === 'pepco'
    && url?.hostname.endsWith('pepco.cz')
    && url.pathname.includes('/kolekce/letaky');
}

async function showPepcoCollection() {
  statusNode.textContent = 'Načítám aktuální nabídku Pepco…';
  const today = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams({
    select: 'title,price,old_price,image_url,valid_from,valid_to,stores!inner(slug)',
    'stores.slug': 'eq.pepco',
    status: 'eq.published',
    valid_to: `gte.${today}`,
    order: 'price.asc',
    limit: '100',
  });
  const response = await fetchWithTimeout(
    `https://${SUPABASE_HOST}/rest/v1/offers?${query}`,
    { headers: { apikey: SUPABASE_KEY }, cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Nabídku Pepco se nepodařilo načíst (${response.status}).`);
  const offers = await response.json();
  if (!Array.isArray(offers) || !offers.length) throw new Error('Aktuální nabídka Pepco je prázdná.');

  const unique = [...new Map(offers.map((offer) => [
    `${offer.title}|${offer.price}|${offer.image_url}`,
    offer,
  ])).values()];

  if (!document.getElementById('pepcoCollectionStyles')) {
    const style = document.createElement('style');
    style.id = 'pepcoCollectionStyles';
    style.textContent = `
      .pepcoCollectionIntro{width:min(1120px,calc(100% - 24px));margin:10px auto 18px;padding:18px 20px;border-radius:18px;background:linear-gradient(135deg,#0757a6,#126dbb);color:#fff;box-sizing:border-box}
      .pepcoCollectionIntro strong{display:block;font-size:clamp(20px,3vw,28px);margin-bottom:5px}
      .pepcoCollectionIntro span{font-size:14px;opacity:.9}
      .pepcoCollectionGrid{width:min(1120px,calc(100% - 24px));margin:0 auto 36px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
      .pepcoOfferCard{overflow:hidden;border:1px solid #d9e4ee;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(15,43,67,.08)}
      .pepcoOfferImage{aspect-ratio:1/1;background:#f7fafc;display:flex;align-items:center;justify-content:center}
      .pepcoOfferImage img{width:100%;height:100%;object-fit:contain}
      .pepcoOfferBody{padding:13px 14px 15px}
      .pepcoOfferBody h3{min-height:42px;margin:0 0 12px;color:#10253b;font-size:15px;line-height:1.35}
      .pepcoOfferPrice{display:flex;align-items:baseline;gap:8px;color:#0757a6;font-size:23px;font-weight:800}
      .pepcoOfferOld{color:#7b8792;font-size:13px;font-weight:500;text-decoration:line-through}
      @media(max-width:600px){.pepcoCollectionGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;width:calc(100% - 16px)}.pepcoCollectionIntro{width:calc(100% - 16px)}.pepcoOfferBody{padding:10px}.pepcoOfferBody h3{font-size:13px}.pepcoOfferPrice{font-size:19px}}
    `;
    document.head.appendChild(style);
  }

  const price = (value) => new Intl.NumberFormat('cs-CZ', {
    style: 'currency', currency: 'CZK', maximumFractionDigits: 0,
  }).format(Number(value));
  const dates = unique[0]?.valid_from && unique[0]?.valid_to
    ? `Platí ${new Date(unique[0].valid_from + 'T12:00:00').toLocaleDateString('cs-CZ')}–${new Date(unique[0].valid_to + 'T12:00:00').toLocaleDateString('cs-CZ')}`
    : 'Aktuální nabídka';

  pagesRoot.innerHTML = `
    <section class="pepcoCollectionIntro">
      <strong>Aktuální nabídka Pepco</strong>
      <span>${escapeHtml(dates)} · nabídku prohlížíte přímo na Slevao.cz</span>
    </section>
    <section class="pepcoCollectionGrid">
      ${unique.map((offer) => {
        const image = safeHttpsUrl(offer.image_url);
        return `<article class="pepcoOfferCard">
          <div class="pepcoOfferImage">${image ? `<img src="${escapeHtml(image.href)}" alt="${escapeHtml(offer.title)}" loading="lazy" decoding="async">` : ''}</div>
          <div class="pepcoOfferBody">
            <h3>${escapeHtml(offer.title)}</h3>
            <div class="pepcoOfferPrice">${escapeHtml(price(offer.price))}${offer.old_price ? `<span class="pepcoOfferOld">${escapeHtml(price(offer.old_price))}</span>` : ''}</div>
          </div>
        </article>`;
      }).join('')}
    </section>`;
  statusNode.textContent = 'Nabídka Pepco je otevřená – posouvej dolů';
  countNode.textContent = `${unique.length} produktů`;
}

async function boot() {
  try {
    if (!source) throw new Error('Chybí adresa letáku.');
    if (isPepcoCollectionSource()) {
      await showPepcoCollection();
      return;
    }
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
    if (error instanceof DirectDocumentOpen && openDocumentDirectly(error.url)) return;
    showError(error instanceof Error ? error.message : 'Neznámá chyba.');
  }
}

boot();
