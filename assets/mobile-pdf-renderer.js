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
  let pageObserver = null;

  const style = document.createElement('style');
  style.textContent = `
    @media(max-width:820px){
      .leafletViewer.pdfjs-rendering{display:flex;flex-direction:column;height:100dvh;min-height:0}
      .pdfLeafletPages{flex:1 1 auto;width:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0;background:#dfe5e7;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      .pdfLeafletPage{display:flex;align-items:flex-start;justify-content:center;width:100%;min-height:0;margin:0 0 8px;background:#fff}
      .pdfLeafletPage canvas{display:block;width:100%;max-width:100%;height:auto;box-shadow:0 1px 5px rgba(0,0,0,.14)}
      .pdfLeafletMessage{display:grid;place-items:center;min-height:260px;padding:24px;color:#53615f;text-align:center}
      .leafletViewer.pdfjs-rendering iframe,.leafletViewer.pdfjs-rendering .leafletViewerStatus{display:none!important}
    }
  `;
  document.head.appendChild(style);

  const pages = document.createElement('div');
  pages.className = 'pdfLeafletPages';
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

  function resetPages() {
    pageObserver?.disconnect();
    pageObserver = null;
    pages.innerHTML = '';
    pages.scrollTop = 0;
  }

  function restoreNativeViewer() {
    renderToken += 1;
    source = '';
    resetPages();
    pages.hidden = true;
    viewer.classList.remove('pdfjs-rendering');
    frame.style.removeProperty('display');
    frame.style.removeProperty('width');
    frame.style.removeProperty('max-width');
    frame.style.removeProperty('height');
  }

  function showMessage(text) {
    resetPages();
    pages.innerHTML = `<div class="pdfLeafletMessage">${text}</div>`;
    pages.hidden = false;
    viewer.classList.add('pdfjs-rendering');
  }

  async function renderPdf(nextSource) {
    if (!media.matches || viewer.hidden || !nextSource) return;
    const token = ++renderToken;
    source = cleanSource(nextSource);
    showMessage('Načítám leták podle velikosti displeje…');

    try {
      const pdfjsLib = await loadPdfJs();
      if (!pdfjsLib || token !== renderToken || !media.matches) return;
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

      const response = await fetch(source, { cache: 'no-store' });
      if (!response.ok) throw new Error(`PDF se nepodařilo načíst (${response.status}).`);
      const data = await response.arrayBuffer();
      if (token !== renderToken || !media.matches) return;

      const pdf = await pdfjsLib.getDocument({ data }).promise;
      if (token !== renderToken || !media.matches) return;

      resetPages();
      pages.hidden = false;
      viewer.classList.add('pdfjs-rendering');
      const availableWidth = Math.max(280, pages.clientWidth || document.documentElement.clientWidth);
      const wrappers = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        if (token !== renderToken || !media.matches) return;
        const base = page.getViewport({ scale: 1 });
        const cssScale = availableWidth / base.width;
        const cssHeight = Math.floor(base.height * cssScale);

        const wrapper = document.createElement('div');
        wrapper.className = 'pdfLeafletPage';
        wrapper.dataset.page = String(pageNumber);
        wrapper.style.minHeight = `${cssHeight}px`;
        wrapper._pdfPage = page;
        wrapper._cssScale = cssScale;
        wrappers.push(wrapper);
        pages.appendChild(wrapper);
      }

      const drawPage = async (wrapper) => {
        if (!wrapper || wrapper.dataset.rendered || wrapper.dataset.rendering || token !== renderToken || !media.matches) return;
        wrapper.dataset.rendering = 'true';
        const outputScale = Math.min(window.devicePixelRatio || 1, 1.6);
        const viewport = wrapper._pdfPage.getViewport({ scale: wrapper._cssScale * outputScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        wrapper.replaceChildren(canvas);
        await wrapper._pdfPage.render({
          canvasContext: canvas.getContext('2d', { alpha: false }),
          viewport,
        }).promise;
        wrapper.dataset.rendered = 'true';
        delete wrapper.dataset.rendering;
      };

      pageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) drawPage(entry.target);
        });
      }, { root: pages, rootMargin: '900px 0px' });

      wrappers.forEach((wrapper) => pageObserver.observe(wrapper));
      await drawPage(wrappers[0]);
    } catch (error) {
      if (token !== renderToken) return;
      restoreNativeViewer();
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

  closeButton?.addEventListener('click', restoreNativeViewer);

  const rerender = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!media.matches) {
        restoreNativeViewer();
        return;
      }
      if (!source || viewer.hidden) {
        inspectFrame();
        return;
      }
      const currentSource = source;
      source = '';
      renderPdf(currentSource);
    }, 260);
  };

  window.addEventListener('orientationchange', rerender);
  window.addEventListener('resize', rerender);
  media.addEventListener?.('change', rerender);
  inspectFrame();
})();
