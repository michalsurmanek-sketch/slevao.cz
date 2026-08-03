(() => {
  'use strict';

  const PDFJS_VERSION = '6.1.200';
  const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
  const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  const MAX_PDF_SIZE = 50 * 1024 * 1024;
  const MAX_PAGES = 160;
  const TARGET_WIDTH = 1800;
  const WEBP_QUALITY = 0.9;

  let pdfjsPromise;
  let converting = false;

  const isPdf = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
  const formatBytes = (bytes) => {
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  };

  function message(text, type = 'info') {
    const box = document.getElementById('uploadMessage');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text;
    box.className = `message ${type}`;
  }

  async function pdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(PDFJS_URL).then((library) => {
        library.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return library;
      });
    }
    return pdfjsPromise;
  }

  function canvasToWebp(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Stránku PDF se nepodařilo převést do WebP.'));
      }, 'image/webp', WEBP_QUALITY);
    });
  }

  function baseName(filename) {
    return String(filename || 'letak')
      .replace(/\.pdf$/i, '')
      .replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'letak';
  }

  async function splitPdf(file) {
    if (file.size > MAX_PDF_SIZE) {
      throw new Error(`${file.name} má ${formatBytes(file.size)}. PDF může mít nejvýše 50 MB.`);
    }

    const library = await pdfjs();
    const loadingTask = library.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const document = await loadingTask.promise;
    const pageCount = Number(document.numPages || 0);

    if (!pageCount) throw new Error(`${file.name} neobsahuje žádné stránky.`);
    if (pageCount > MAX_PAGES) throw new Error(`${file.name} má ${pageCount} stran. Maximum je ${MAX_PAGES} stran.`);

    const width = String(pageCount).length;
    const batchId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const name = baseName(file.name);
    const result = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      message(`Připravuji celý PDF leták: stránka ${pageNumber} z ${pageCount}. Nezavírej stránku.`, 'info');
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.max(1, Math.min(3, TARGET_WIDTH / Math.max(1, natural.width)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Prohlížeč neumí vytvořit plátno pro stránku PDF.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await canvasToWebp(canvas);
      const pageLabel = String(pageNumber).padStart(width, '0');
      const totalLabel = String(pageCount).padStart(width, '0');
      const converted = new File(
        [blob],
        `${name}__page-${pageLabel}-of-${totalLabel}__batch-${batchId}.webp`,
        { type: 'image/webp', lastModified: file.lastModified || Date.now() },
      );
      result.push(converted);
      page.cleanup?.();
      canvas.width = 1;
      canvas.height = 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await document.destroy?.();
    return result;
  }

  function setInputFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
  }

  function looksLikeOnlyFirstPage(files) {
    return files.length === 1
      && !isPdf(files[0])
      && /(?:^|[_-])page[_-]?0*1(?:[_-]|\.)/i.test(files[0]?.name || '');
  }

  async function expandAndDispatch(input, files) {
    if (converting) return;
    converting = true;
    try {
      const expanded = [];
      let pdfCount = 0;
      for (const file of files) {
        if (isPdf(file)) {
          pdfCount++;
          expanded.push(...await splitPdf(file));
        } else {
          expanded.push(file);
        }
      }
      setInputFiles(input, expanded);
      input.dataset.pdfExpanded = '1';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const pages = expanded.length;
      window.setTimeout(() => {
        message(pdfCount
          ? `PDF bylo rozděleno na všech ${pages} stran. Každá stránka je ve frontě a zpracuje se samostatně.`
          : `${pages} souborů bylo přidáno do fronty.`, 'ok');
      }, 0);
    } catch (error) {
      message(error?.message || 'PDF se nepodařilo připravit.', 'err');
    } finally {
      converting = false;
    }
  }

  function bind() {
    const input = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    if (!input || !dropZone) return;

    input.addEventListener('change', (event) => {
      if (input.dataset.pdfExpanded === '1') {
        delete input.dataset.pdfExpanded;
        return;
      }
      const files = [...(input.files || [])];
      if (files.some(isPdf)) {
        event.stopImmediatePropagation();
        void expandAndDispatch(input, files);
        return;
      }
      if (looksLikeOnlyFirstPage(files)) {
        window.setTimeout(() => message('Pozor: vybral jsi pouze obrázek první stránky. Pro celý leták nahraj původní PDF nebo označ všechny stránky najednou.', 'err'), 0);
      }
    }, true);

    dropZone.addEventListener('drop', (event) => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.some(isPdf)) {
        if (looksLikeOnlyFirstPage(files)) {
          window.setTimeout(() => message('Pozor: přetáhl jsi pouze obrázek první stránky. Pro celý leták přetáhni PDF nebo všechny stránky.', 'err'), 0);
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      dropZone.classList.remove('drag');
      void expandAndDispatch(input, files);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
