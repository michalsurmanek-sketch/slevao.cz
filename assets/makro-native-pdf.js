(() => {
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
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

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function applyOriginalPdf() {
    if (!previewUrl || applying) return;
    applying = true;
    try {
      const cards = [...grid.querySelectorAll('[data-leaflet-preview]')];
      if (!cards.length) return;

      const primary = cards[0];
      if (cards.length > 1) cards.slice(1).forEach((card) => card.remove());
      if (primary.dataset.leafletPreview !== previewUrl) primary.dataset.leafletPreview = previewUrl;
      if (primary.dataset.leafletTitle !== 'Makro') primary.dataset.leafletTitle = 'Makro';
      if (grid.dataset.count !== '1') grid.dataset.count = '1';

      setText(primary.querySelector('h3'), 'Makro');
      setText(primary.querySelector('.leafletBody p'), 'Aktuální vícestránkový PDF leták');
      setText(primary.querySelector('.leafletType'), 'Akční leták');

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
