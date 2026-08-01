(() => {
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FEED_URL = `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=makro&source=official-v6`;
  const DOCUMENT_URL = `${SUPABASE_URL}/functions/v1/store-leaflet-document`;
  const viewer = document.getElementById('leafletViewer');
  const frame = document.getElementById('leafletFrame');
  const status = document.getElementById('leafletViewerStatus');
  const grid = document.getElementById('leafletGrid');
  const closeButton = document.getElementById('closeLeafletViewer');
  if (!viewer || !frame || !grid) return;

  let pdfSource = '';
  let resolvedPdf = '';
  let objectUrl = '';
  let loading = false;

  const isPdf = (value) => {
    try { return /\.pdf$/i.test(new URL(String(value || '')).pathname); }
    catch { return /\.pdf(?:[?#]|$)/i.test(String(value || '')); }
  };

  const cleanupObjectUrl = () => {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  };

  const showNativePdf = async () => {
    if (!pdfSource || viewer.hidden || loading) return;
    const current = frame.getAttribute('src') || '';
    if (resolvedPdf && current.startsWith(resolvedPdf)) return;
    loading = true;
    try {
      status?.removeAttribute('hidden');
      if (status) {
        status.className = 'leafletViewerStatus loading';
        status.textContent = 'Načítám PDF leták…';
      }

      const response = await fetch(`${DOCUMENT_URL}?source_url=${encodeURIComponent(pdfSource)}`, {
        headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);

      let payload = null;
      try { payload = await response.clone().json(); } catch { /* PDF blob */ }
      cleanupObjectUrl();
      if (payload && typeof payload === 'object' && String(payload.url || '').startsWith(`${SUPABASE_URL}/storage/v1/object/sign/`)) {
        resolvedPdf = String(payload.url);
      } else {
        const bytes = await response.arrayBuffer();
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        resolvedPdf = objectUrl;
      }

      frame.src = `${resolvedPdf}#page=1&zoom=page-fit`;
      frame.hidden = false;
      if (status) status.hidden = true;
    } catch (error) {
      console.error('MAKRO PDF viewer:', error);
    } finally {
      loading = false;
    }
  };

  const keepOnePdfCard = () => {
    if (!pdfSource) return;
    const cards = [...grid.querySelectorAll('.leafletCard')];
    cards.slice(1).forEach((card) => card.remove());
    if (cards.length) {
      cards[0].dataset.leafletTitle = cards[0].dataset.leafletTitle || 'Makro';
      grid.dataset.count = '1';
    }
  };

  fetch(FEED_URL, { headers: { apikey: KEY }, cache: 'no-store' })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Feed HTTP ${response.status}`)))
    .then((payload) => {
      const pdf = Array.isArray(payload.leaflets)
        ? payload.leaflets.find((leaflet) => isPdf(leaflet?.url))
        : null;
      if (!pdf) return;
      pdfSource = String(pdf.url);
      keepOnePdfCard();
      showNativePdf();
    })
    .catch((error) => console.error('MAKRO PDF feed:', error));

  new MutationObserver(() => {
    keepOnePdfCard();
    showNativePdf();
  }).observe(grid, { childList: true, subtree: true });

  new MutationObserver(showNativePdf).observe(viewer, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  new MutationObserver(showNativePdf).observe(frame, {
    attributes: true,
    attributeFilter: ['src', 'hidden'],
  });

  closeButton?.addEventListener('click', () => {
    resolvedPdf = '';
    cleanupObjectUrl();
  });
})();
