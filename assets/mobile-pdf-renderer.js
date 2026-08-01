(() => {
  const MOBILE_QUERY = '(max-width: 820px)';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const frame = document.getElementById('leafletFrame');
  const viewer = document.getElementById('leafletViewer');
  const closeButton = document.getElementById('closeLeafletViewer');
  if (!frame || !viewer) return;

  const media = window.matchMedia(MOBILE_QUERY);
  let renderToken = 0;
  let source = '';
  let resizeTimer = 0;

  const style = document.createElement('style');
  style.textContent = `
    @media (max-width:820px){
      .mobilePdfPages{flex:1 1 auto;width:100%;min-height:0;overflow-y:auto;overflow-x:hidden;background:#e8edef;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      .mobilePdfPage{display:block;width:100%;margin:0 0 8px;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.14)}
      .mobilePdfPage canvas{display:block;width:100%;height:auto}
      .mobilePdfMessage{display:grid;place-items:center;min-height:220px;padding:24px;color:#53615f;text-align:center}
      .leafletViewer.mobile-rendering iframe{display:none!important}
      .leafletViewer.mobile-rendering .leafletViewerStatus{display:none!important}
    }
  `;
  document.head.appendChild(style);

  const pages = document.createElement('div');
  pages.className = 'mobilePdfPages';
  pages.hidden = true;
  frame.before(pages);

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${PDFJS_URL}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(window.pdfjsLib), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = PDFJS_URL;
      script.async = true;
      script.onload = () => resolve(window.pdfjsLib);
      script.onerror = () => reject(new Error('Nepodařilo se načíst mobilní prohlížeč PDF.'));
      document.head.appendChild(script);
    });
  }

  function cleanSource(value) {
    return String(value || '').split('#')[0];
  }

  function showMessage(text) {
    pages.innerHTML = `<div class="mobilePdfMessage">${text}</div>`;
    pages.hidden = false;
    viewer.classList.add('mobile-rendering');
  }

  async function renderPdf(nextSource) {
    if (!media.matches || viewer.hidden || !nextSource) return;
    const token = ++renderToken;
    source = cleanSource(nextSource);
    showMessage('Načítám leták podle velikosti displeje…');

    try {
      const pdfjsLib = await loadPdfJs();
      if (!pdfjsLib || token !== renderToken) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

      const response = await fetch(source, { cache: 'no-store' });
      if (!response.ok) throw new Error(`PDF se nepodařilo načíst (${response.status}).`);
      const data = await response.arrayBuffer();
      if (token !== renderToken) return;

      const pdf = await pdfjsLib.getDocument({ data }).promise;
      if (token !== renderToken) return;
      pages.innerHTML = '';
      pages.hidden = false;
      viewer.classList.add('mobile-rendering');

      const availableWidth = Math.max(280, pages.clientWidth || document.documentElement.clientWidth);
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (token !== renderToken) return;
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = availableWidth / baseViewport.width;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * outputScale });

        const wrapper = document.createElement('div');
        wrapper.className = 'mobilePdfPage';
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        wrapper.appendChild(canvas);
        pages.appendChild(wrapper);

        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      }
    } catch (error) {
      if (token !== renderToken) return;
      showMessage(error instanceof Error ? error.message : 'Leták se nepodařilo zobrazit.');
      frame.style.display = 'block';
      viewer.classList.remove('mobile-rendering');
      pages.hidden = true;
    }
  }

  function inspectFrame() {
    if (!media.matches || viewer.hidden || frame.hidden) return;
    const nextSource = cleanSource(frame.getAttribute('src'));
    if (!nextSource || nextSource === 'about:blank' || nextSource === source) return;
    renderPdf(nextSource);
  }

  new MutationObserver(inspectFrame).observe(frame, {
    attributes: true,
    attributeFilter: ['src', 'hidden'],
  });

  closeButton?.addEventListener('click', () => {
    renderToken += 1;
    source = '';
    pages.innerHTML = '';
    pages.hidden = true;
    viewer.classList.remove('mobile-rendering');
    frame.style.removeProperty('display');
  });

  const rerender = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!source || !media.matches || viewer.hidden) return;
      const currentSource = source;
      source = '';
      renderPdf(currentSource);
    }, 220);
  };

  window.addEventListener('orientationchange', rerender);
  window.addEventListener('resize', rerender);
  media.addEventListener?.('change', () => {
    if (media.matches) inspectFrame();
    else {
      renderToken += 1;
      pages.hidden = true;
      viewer.classList.remove('mobile-rendering');
    }
  });

  inspectFrame();
})();
