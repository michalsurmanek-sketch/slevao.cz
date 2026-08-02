(() => {
  'use strict';

  const config = window.SLEVAO_STORE || {};
  if (config.slug !== 'globus') return;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const OFFICIAL_URL = 'https://www.globus.cz/olomouc/letaky/aktualni';

  let resolvedPreviewUrl = '';
  let resolvedPdfUrl = '';
  let resolvingPromise = null;
  let leafletObjectUrl = '';
  let applying = false;
  let closedByUser = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function safeHttps(value) {
    try {
      const url = new URL(String(value || '').replace(/&amp;/gi, '&'));
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function extractPdfUrl(html) {
    const source = String(html || '')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&');

    const candidates = new Set();
    const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,300}?(?:Stáhnout\s+v\s+PDF|Stahnout\s+v\s+PDF)[\s\S]{0,100}?<\/a>/gi;
    const assetPattern = /https:\/\/gapi\.globus\.cz\/OnlineAsset\/3\/asset\?assetID=[0-9a-f-]+(?:&[^\s"'<>]*)?/gi;

    let match;
    while ((match = anchorPattern.exec(source))) candidates.add(match[1]);
    while ((match = assetPattern.exec(source))) candidates.add(match[0]);

    const normalized = [...candidates]
      .map(safeHttps)
      .filter((url) => /^https:\/\/gapi\.globus\.cz\/OnlineAsset\/3\/asset\?assetID=/i.test(url));

    const pdfAsset = normalized.find((url) => !/[?&]type=\d+/i.test(url));
    if (pdfAsset) return pdfAsset;

    const labelledPdf = normalized.find((url) => /pdf|download/i.test(url));
    if (labelledPdf) return labelledPdf;

    throw new Error('Oficiální stránka Globusu neobsahuje odkaz na PDF leták.');
  }

  async function fetchSourceHtml(previewUrl) {
    const response = await fetch(previewUrl, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Globus leták vrátil HTTP ${response.status}.`);

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const sourceUrl = safeHttps(payload?.url);
      if (!sourceUrl) throw new Error(payload?.error || 'Globus nevrátil platný zdroj letáku.');
      const sourceResponse = await fetch(sourceUrl, { cache: 'no-store' });
      if (!sourceResponse.ok) throw new Error(`Zdroj Globusu vrátil HTTP ${sourceResponse.status}.`);
      return sourceResponse.text();
    }

    return response.text();
  }

  async function resolvePdf(previewUrl) {
    if (resolvedPdfUrl && resolvedPreviewUrl === previewUrl) return resolvedPdfUrl;
    if (resolvingPromise && resolvedPreviewUrl === previewUrl) return resolvingPromise;

    resolvedPreviewUrl = previewUrl;
    resolvingPromise = (async () => {
      const html = await fetchSourceHtml(previewUrl);
      resolvedPdfUrl = extractPdfUrl(html);
      return resolvedPdfUrl;
    })().finally(() => {
      resolvingPromise = null;
    });

    return resolvingPromise;
  }

  function fitViewer() {
    const frame = document.getElementById('leafletFrame');
    if (!frame || frame.hidden) return;
    const top = Math.max(frame.getBoundingClientRect().top, innerWidth <= 520 ? 76 : 96);
    const minimum = innerWidth <= 520 ? 360 : 420;
    frame.style.height = `${Math.max(minimum, Math.min(900, innerHeight - top - 12))}px`;
  }

  function startLoading(title) {
    const viewer = document.getElementById('leafletViewer');
    const frame = document.getElementById('leafletFrame');
    const status = document.getElementById('leafletViewerStatus');
    if (!viewer || !frame || !status) return null;

    closedByUser = false;
    document.getElementById('leafletViewerTitle').textContent = title || 'Globus – aktuální leták';
    frame.hidden = true;
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    viewer.hidden = false;
    status.hidden = false;
    status.className = 'leafletViewerStatus loading';
    status.textContent = 'Načítám PDF leták Globus…';
    document.querySelector('.leafletViewerHelp')?.replaceChildren(document.createTextNode('Leták můžeš listovat, přibližovat a otevřít přes celou obrazovku.'));

    if (matchMedia('(max-width: 820px)').matches) {
      document.body.classList.add('leaflet-viewer-open');
    }

    return { viewer, frame, status };
  }

  async function localPdfUrl(pdfUrl) {
    try {
      const response = await fetch(pdfUrl, {
        headers: { accept: 'application/pdf,*/*;q=0.8' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`PDF vrátil HTTP ${response.status}.`);
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      const isPdf = String(blob.type || '').toLowerCase().includes('pdf')
        || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
      if (!isPdf) throw new Error('Stažený soubor není PDF.');
      if (leafletObjectUrl) URL.revokeObjectURL(leafletObjectUrl);
      leafletObjectUrl = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
      return leafletObjectUrl;
    } catch {
      // GAPI nemusí povolit CORS. Přímé vložení PDF do iframe funguje i bez CORS.
      return pdfUrl;
    }
  }

  async function openPdfLeaflet(previewUrl, title, shouldScroll = true) {
    if (!previewUrl) return;
    const view = startLoading(title);
    if (!view) return;

    document.querySelectorAll('#leafletGrid [data-leaflet-preview]').forEach((button) => {
      button.classList.toggle('active', button.dataset.leafletPreview === previewUrl);
    });

    if (shouldScroll && !matchMedia('(max-width: 820px)').matches) {
      view.viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
      const pdfUrl = await resolvePdf(previewUrl);
      const displayUrl = await localPdfUrl(pdfUrl);
      if (closedByUser) return;

      applying = true;
      view.frame.removeAttribute('srcdoc');
      view.frame.src = `${displayUrl}#page=1&zoom=page-fit`;
      view.frame.hidden = false;
      view.frame.dataset.globusPdf = 'ready';
      view.status.hidden = true;
      requestAnimationFrame(fitViewer);
      setTimeout(() => {
        fitViewer();
        applying = false;
      }, 450);
    } catch (error) {
      if (closedByUser) return;
      view.status.hidden = false;
      view.status.className = 'leafletViewerStatus error';
      view.status.innerHTML = `<strong>Leták se nepodařilo zobrazit.</strong><span>${esc(error?.message || 'Zkus stránku obnovit.')}</span><a href="${esc(OFFICIAL_URL)}" target="_blank" rel="noopener noreferrer">Otevřít leták na Globus.cz ↗</a>`;
    }
  }

  function prepareButton(button) {
    if (!button) return;
    button.dataset.globusPdfPrepared = '1';
    button.dataset.leafletTitle = 'Globus – aktuální leták';
    const action = button.querySelector('.leafletAction');
    if (action) action.textContent = 'Prolistovat přímo zde';
    const type = button.querySelector('.leafletType');
    if (type) type.textContent = 'Akční leták';
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#leafletGrid [data-leaflet-preview]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    prepareButton(button);
    openPdfLeaflet(button.dataset.leafletPreview, button.dataset.leafletTitle);
  }, true);

  window.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('leafletGrid');
    const viewer = document.getElementById('leafletViewer');
    const frame = document.getElementById('leafletFrame');
    if (!grid || !viewer || !frame) return;

    const gridObserver = new MutationObserver(() => {
      const button = grid.querySelector('[data-leaflet-preview]');
      if (!button) return;
      prepareButton(button);
    });
    gridObserver.observe(grid, { childList: true, subtree: true });

    const frameObserver = new MutationObserver(() => {
      if (applying || closedByUser || viewer.hidden) return;
      const button = grid.querySelector('[data-leaflet-preview]');
      if (!button) return;
      prepareButton(button);
      if (frame.dataset.globusPdf !== 'ready') {
        frame.hidden = true;
        openPdfLeaflet(button.dataset.leafletPreview, button.dataset.leafletTitle, false);
      }
    });
    frameObserver.observe(frame, { attributes: true, attributeFilter: ['src', 'srcdoc', 'hidden'] });
    frameObserver.observe(viewer, { attributes: true, attributeFilter: ['hidden'] });

    document.getElementById('closeLeafletViewer')?.addEventListener('click', () => {
      closedByUser = true;
      frame.dataset.globusPdf = '';
      frame.removeAttribute('srcdoc');
      if (leafletObjectUrl) {
        URL.revokeObjectURL(leafletObjectUrl);
        leafletObjectUrl = '';
      }
    }, { capture: true });

    const existing = grid.querySelector('[data-leaflet-preview]');
    if (existing) prepareButton(existing);
  });

  window.addEventListener('beforeunload', () => {
    if (leafletObjectUrl) URL.revokeObjectURL(leafletObjectUrl);
  }, { once: true });
})();