from pathlib import Path

js_path = Path('assets/home-leaflet-covers.js')
js = js_path.read_text(encoding='utf-8')

js = js.replace(
    "const PDFJS_MODULE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;",
    "const PDFJS_MODULE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.mjs`;",
    1,
)
js = js.replace(
    "const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;",
    "const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`;",
    1,
)
js = js.replace(
    "const COVER_CACHE = 'slevao-current-leaflet-covers-v1';",
    "const COVER_CACHE = 'slevao-current-leaflet-covers-v2';",
    1,
)

old_loading = '''  function setLoading(card) {
    const cover = card.querySelector('.leafletCover');
    if (!cover) return;
    card.dataset.leafletCoverState = 'loading';
    cover.innerHTML = `
      <span class="leafletCoverLoader" aria-hidden="true"></span>
      <span class="leafletCoverLoadingText">Načítám titulní stranu…</span>`;
  }
'''
new_loading = '''  function setLoading(card) {
    const cover = card.querySelector('.leafletCover');
    if (!cover) return;
    const logo = cover.querySelector('.leafletStoreLogo');
    if (logo?.src) card.dataset.leafletLogo = logo.src;
    card.dataset.leafletCoverState = 'loading';
    cover.innerHTML = `
      <span class="leafletCoverLoader" aria-hidden="true"></span>
      <span class="leafletCoverLoadingText">Načítám titulní stranu…</span>`;
  }

  function applyUnavailableCover(card) {
    const cover = card.querySelector('.leafletCover');
    if (!cover) return;
    const name = storeName(card);
    const logo = String(card.dataset.leafletLogo || '');
    cover.innerHTML = `
      <div class="leafletFallbackCover">
        ${logo ? `<img src="${esc(logo)}" alt="Logo ${esc(name)}">` : '<span aria-hidden="true">▤</span>'}
        <strong>Aktuální leták</strong>
        <small>Náhled se právě připravuje</small>
      </div>`;
    card.dataset.leafletCoverState = 'fallback';
  }
'''
if old_loading not in js:
    raise SystemExit('Loading function marker not found')
js = js.replace(old_loading, new_loading, 1)

old_cover_for = '''  async function coverFor(slug) {
    if (!coverPromises.has(slug)) {
      coverPromises.set(slug, (async () => {
        const leaflet = await fetchLeaflet(slug);
        let cover = await cachedCover(leaflet.preview_url);
        if (!cover) {
          cover = await renderFirstPage(await fetchLeafletBlob(leaflet.preview_url));
          await saveCover(leaflet.preview_url, cover);
        }
        return { leaflet, cover };
      })());
    }
    return coverPromises.get(slug);
  }
'''
new_cover_for = '''  async function coverFor(slug) {
    if (!coverPromises.has(slug)) {
      coverPromises.set(slug, (async () => {
        const leaflet = await fetchLeaflet(slug);
        let cover = await cachedCover(leaflet.preview_url);
        if (!cover) {
          try {
            cover = await renderFirstPage(await fetchLeafletBlob(leaflet.preview_url));
            await saveCover(leaflet.preview_url, cover);
          } catch (renderError) {
            console.warn(`PDF náhled ${slug} použije nativní zobrazení:`, renderError);
            return { leaflet, cover: null };
          }
        }
        return { leaflet, cover };
      })());
    }
    return coverPromises.get(slug);
  }
'''
if old_cover_for not in js:
    raise SystemExit('coverFor marker not found')
js = js.replace(old_cover_for, new_cover_for, 1)

old_apply_start = '''    const objectUrl = URL.createObjectURL(result.cover);
    objectUrls.add(objectUrl);
    cover.innerHTML = `
      <img class="leafletFrontPage" src="${esc(objectUrl)}" alt="Titulní strana aktuálního letáku ${esc(name)}">
      <span class="leafletCurrentBadge">Aktuální leták</span>`;
'''
new_apply_start = '''    if (result.cover) {
      const objectUrl = URL.createObjectURL(result.cover);
      objectUrls.add(objectUrl);
      cover.innerHTML = `
        <img class="leafletFrontPage" src="${esc(objectUrl)}" alt="Titulní strana aktuálního letáku ${esc(name)}">
        <span class="leafletCurrentBadge">Aktuální leták</span>`;
    } else {
      const separator = String(result.leaflet.preview_url).includes('#') ? '&' : '#';
      const nativeUrl = `${result.leaflet.preview_url}${separator}page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
      cover.innerHTML = `
        <iframe class="leafletFrontPageFrame" src="${esc(nativeUrl)}" title="Titulní strana aktuálního letáku ${esc(name)}" loading="lazy" tabindex="-1"></iframe>
        <span class="leafletCurrentBadge">Aktuální leták</span>`;
    }
'''
if old_apply_start not in js:
    raise SystemExit('applyCover marker not found')
js = js.replace(old_apply_start, new_apply_start, 1)

old_catch = '''    } catch (error) {
      console.warn(`Titulní strana letáku ${slug} není dostupná:`, error);
      card.remove();
    }
'''
new_catch = '''    } catch (error) {
      console.warn(`Titulní strana letáku ${slug} zatím není dostupná:`, error);
      applyUnavailableCover(card);
    }
'''
if old_catch not in js:
    raise SystemExit('decorate catch marker not found')
js = js.replace(old_catch, new_catch, 1)
js_path.write_text(js, encoding='utf-8')

css_path = Path('assets/home-leaflet-covers.css')
css = css_path.read_text(encoding='utf-8')
addition = '''
#leafletGrid .leafletFrontPageFrame{display:block;width:100%;height:100%;border:0;background:#fff;pointer-events:none}
#leafletGrid .leafletFallbackCover{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;background:linear-gradient(155deg,#fff,#edf8f6);text-align:center}
#leafletGrid .leafletFallbackCover img{display:block;max-width:70%;max-height:76px;object-fit:contain}
#leafletGrid .leafletFallbackCover>span{font-size:52px;color:var(--brand-dark)}
#leafletGrid .leafletFallbackCover strong{font-size:18px}
#leafletGrid .leafletFallbackCover small{color:var(--muted);font-weight:750}
#leafletGrid .leafletCard[data-leaflet-cover-state="fallback"]{display:flex!important}
'''
if '.leafletFrontPageFrame' not in css:
    css += addition
css_path.write_text(css, encoding='utf-8')

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')
html = html.replace('assets/home-leaflet-covers.css?v=20260802-1', 'assets/home-leaflet-covers.css?v=20260802-2')
html = html.replace('assets/home-leaflet-covers.js?v=20260802-1', 'assets/home-leaflet-covers.js?v=20260802-2')
index_path.write_text(html, encoding='utf-8')
