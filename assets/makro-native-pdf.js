(() => {
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PUBLITAS_API = 'https://api.publitas.com/v1/groups/makro-cz/publications/ultra-fresh-nabidka.json';
  const PUBLITAS_ASSETS = 'https://view.publitas.com';
  const DOCUMENT_ENDPOINT = `${SUPABASE_URL}/functions/v1/store-leaflet-document`;
  const grid = document.getElementById('leafletGrid');
  const viewer = document.getElementById('leafletViewer');
  if (!grid || !viewer) return;

  let previewUrl = '';
  let applying = false;
  let reopenedPreview = '';

  function absolutePdfUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, PUBLITAS_ASSETS);
      if (url.protocol !== 'https:' || url.hostname !== 'view.publitas.com' || !/\.pdf$/i.test(url.pathname)) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function applyOriginalPdf() {
    if (!previewUrl || applying) return;
    applying = true;
    try {
      const cards = [...grid.querySelectorAll('[data-leaflet-preview]')];
      if (!cards.length) return;

      const primary = cards[0];
      cards.slice(1).forEach((card) => card.remove());
      primary.dataset.leafletPreview = previewUrl;
      primary.dataset.leafletTitle = 'Makro';
      grid.dataset.count = '1';

      const title = primary.querySelector('h3');
      const description = primary.querySelector('.leafletBody p');
      const type = primary.querySelector('.leafletType');
      if (title) title.textContent = 'Makro';
      if (description) description.textContent = 'Aktuální vícestránkový PDF leták';
      if (type) type.textContent = 'Akční leták';

      const frame = document.getElementById('leafletFrame');
      const currentFrame = String(frame?.getAttribute('src') || '');
      const viewerAlreadyOpen = !viewer.hidden && Boolean(currentFrame);
      if (viewerAlreadyOpen && reopenedPreview !== previewUrl) {
        reopenedPreview = previewUrl;
        queueMicrotask(() => primary.click());
      }
    } finally {
      applying = false;
    }
  }

  fetch(PUBLITAS_API, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Publitas HTTP ${response.status}`)))
    .then((publication) => {
      const pdfUrl = absolutePdfUrl(publication?.config?.downloadPdfUrl);
      if (!pdfUrl) throw new Error('Publitas nevrátil originální PDF.');
      previewUrl = `${DOCUMENT_ENDPOINT}?source_url=${encodeURIComponent(pdfUrl)}`;
      applyOriginalPdf();
    })
    .catch((error) => console.error('MAKRO PDF:', error));

  new MutationObserver(applyOriginalPdf).observe(grid, { childList: true, subtree: true });
})();
