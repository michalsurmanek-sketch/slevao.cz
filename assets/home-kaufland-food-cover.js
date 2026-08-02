(() => {
  const script = document.createElement('script');
  script.src = `assets/home-all-stores.js?v=20260802-1-${Date.now()}`;
  script.async = false;
  document.head.append(script);
})();

(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const TODAY = new Date().toISOString().slice(0, 10);
  const NEGATIVE = /parkside|non[-_ ]?food|naradi|nářadí|dilna|dílna|hobby|zahrad|textil|odev|oděv|spotreb|spotřeb|elektro|gril|aku|tools?|werkzeug|katalog/i;
  const POSITIVE = /potrav|food|grocery|akcni[-_ ]?letak|akční[-_ ]?leták|tydenni[-_ ]?nabidka|týdenní[-_ ]?nabídka|kaufland[-_ ]?(?:letak|leták)/i;
  const PDF_SOURCES = [
    ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'],
    ['https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.min.mjs', 'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'],
  ];

  let working = false;
  let completedSource = '';
  let pdfjsPromise = null;
  let objectUrl = '';

  async function fetchWithTimeout(url, options = {}, timeout = 24000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function leafletScore(item) {
    const source = [item?.key, item?.title, item?.subtitle, item?.url, item?.preview_url].filter(Boolean).join(' ');
    let score = 0;
    if (NEGATIVE.test(source)) score -= 1000;
    if (POSITIVE.test(source)) score += 300;
    if (/\.pdf(?:$|[?#])/i.test(String(item?.url || ''))) score += 20;
    if (/aktu[aá]ln[ií]|ak[cč]n[ií]/i.test(source)) score += 10;
    if (item?.valid_from && item.valid_from <= TODAY) score += 5;
    if (item?.valid_to && item.valid_to >= TODAY) score += 5;
    return score;
  }

  function chooseFoodLeaflet(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((item) => item?.preview_url)
      .filter((item) => !item.valid_from || item.valid_from <= TODAY)
      .filter((item) => !item.valid_to || item.valid_to >= TODAY)
      .map((item, index) => ({ item, index, score: leafletScore(item) }))
      .filter((entry) => entry.score > -500)
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.item || null;
  }

  async function resolveDocument(url) {
    let response = await fetchWithTimeout(url, {
      headers: { apikey: SUPABASE_KEY, accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Dokument vrátil HTTP ${response.status}.`);
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/json')) {
      const payload = await response.json();
      const redirectedUrl = String(payload?.url || '');
      if (!redirectedUrl.startsWith('https://')) throw new Error('Chybí adresa dokumentu.');
      response = await fetchWithTimeout(redirectedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Soubor vrátil HTTP ${response.status}.`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Dokument je prázdný.');
    return blob;
  }

  async function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = (async () => {
        let lastError;
        for (const [moduleUrl, workerUrl] of PDF_SOURCES) {
          try {
            const module = await import(moduleUrl);
            module.GlobalWorkerOptions.workerSrc = workerUrl;
            return module;
          } catch (error) { lastError = error; }
        }
        throw lastError || new Error('PDF.js není dostupné.');
      })();
    }
    return pdfjsPromise;
  }

  function isPdf(blob, bytes) {
    return String(blob.type || '').toLowerCase().includes('pdf')
      || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  }

  async function coverBlob(documentBlob) {
    const bytes = new Uint8Array(await documentBlob.arrayBuffer());
    if (!isPdf(documentBlob, bytes)) {
      if (!String(documentBlob.type || '').startsWith('image/')) throw new Error('Dokument není PDF ani obrázek.');
      return documentBlob;
    }
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    try {
      const page = await pdf.getPage(1);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.4, 620 / natural.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob) throw new Error('Titulní stranu se nepodařilo vytvořit.');
      return blob;
    } finally { await pdf.destroy(); }
  }

  function kauflandCard() {
    return [...document.querySelectorAll('#leafletGrid .leafletCard')].find((card) => {
      const link = card.querySelector('a[href]')?.getAttribute('href') || '';
      const title = card.querySelector('h3')?.textContent || '';
      return /(?:^|\/)kaufland\.html(?:$|[?#])/i.test(link) || /^kaufland$/i.test(title.trim());
    }) || null;
  }

  function applyLabels(card, image) {
    image.alt = 'Titulní strana aktuálního potravinového letáku Kaufland';
    card.dataset.kauflandFoodLeaflet = '1';
    card.querySelector('.leafletCurrentBadge')?.replaceChildren(document.createTextNode('Potravinový leták'));
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = 'Potraviny a běžné akce';
  }

  async function applyFoodCover() {
    if (working) return;
    const card = kauflandCard();
    const image = card?.querySelector('.leafletFrontPage');
    if (!card || !image) return;
    working = true;
    try {
      const response = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=kaufland&source=homepage-food-cover-v2`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'no-store',
      }, 14000);
      if (!response.ok) throw new Error(`Kaufland feed HTTP ${response.status}.`);
      const payload = await response.json();
      const leaflet = chooseFoodLeaflet(payload?.leaflets);
      if (!leaflet) return;
      if (leaflet.preview_url === completedSource && objectUrl) {
        image.src = objectUrl;
        applyLabels(card, image);
        return;
      }
      const cover = await coverBlob(await resolveDocument(leaflet.preview_url));
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(cover);
      image.src = objectUrl;
      applyLabels(card, image);
      completedSource = leaflet.preview_url;
    } catch (error) {
      console.warn('Potravinový leták Kaufland se nepodařilo nastavit:', error);
    } finally { working = false; }
  }

  const observer = new MutationObserver(() => setTimeout(applyFoodCover, 80));
  window.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    observer.observe(grid, { childList: true, subtree: true });
    applyFoodCover();
  });
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, { once: true });
})();
