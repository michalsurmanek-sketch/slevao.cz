(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const TODAY = new Date().toISOString().slice(0, 10);
  const PUBLIC_FEED = `${SUPABASE_URL}/rest/v1/rpc/get_public_current_leaflets`;
  const CACHE_NAME = 'slevao-all-leaflet-covers-v1';
  const LOCAL_LOGOS = {
    penny: 'assets/logos/penny.svg?v=4',
    'eso-market': 'assets/logos/eso-market.svg?v=1',
  };
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

  const CATEGORY_DEFS = [
    { key:'food', name:'Potraviny', icon:'🛒', slugs:['albert','billa','coop','globus','hruska','kaufland','lidl','makro','penny','tesco','norma','terno','rohlik','kosik','eso-market','flop'] },
    { key:'drugstore', name:'Drogerie', icon:'🧴', slugs:['dm','rossmann','teta'] },
    { key:'home', name:'Dům, dílna a zahrada', icon:'🏠', slugs:['action','bauhaus','hornbach','obi','mountfield','pro-doma','pro-center','procenter','jysk','ikea','mobelix','sconto','tedi'] },
    { key:'electronics', name:'Elektronika', icon:'🔌', slugs:['alza','datart','planeo'] },
    { key:'fashion', name:'Móda a sport', icon:'👕', slugs:['c-a','ca','c-and-a','pepco','kik','takko','sportisimo'] },
    { key:'pharmacy', name:'Lékárny', icon:'💊', slugs:['benu','dr-max','pilulka'] },
    { key:'pets', name:'Chovatelské potřeby', icon:'🐾', slugs:['pet-center','petcenter','super-zoo'] },
    { key:'auto', name:'Auto', icon:'🚗', slugs:['auto-kelly','autokelly'] },
    { key:'other', name:'Ostatní', icon:'🏷️', slugs:[] },
  ];

  const CATEGORY_BY_SLUG = new Map();
  CATEGORY_DEFS.forEach((category) => category.slugs.forEach((slug) => CATEGORY_BY_SLUG.set(slug, category.key)));

  const gridRoot = document.getElementById('leafletCategories');
  const chipRoot = document.getElementById('leafletCategoryChips');
  const totalNode = document.getElementById('leafletsTotal');
  const storeNode = document.getElementById('leafletStoresTotal');

  let pdfjsPromise = null;
  let coverObserver = null;
  const documentPromises = new Map();
  const objectUrls = new Set();

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  }[character]));

  function fold(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function formatDate(value) {
    if (!value) return '';
    const parsed = new Date(`${value}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' }).format(parsed);
  }

  function validityText(leaflet) {
    if (leaflet.valid_from && leaflet.valid_to) return `${formatDate(leaflet.valid_from)}–${formatDate(leaflet.valid_to)}`;
    if (leaflet.valid_to) return `Platí do ${formatDate(leaflet.valid_to)}`;
    if (leaflet.valid_from) return `Platí od ${formatDate(leaflet.valid_from)}`;
    return 'Aktuální vydání';
  }

  function categoryFor(leaflet) {
    const slug = String(leaflet.store_slug || '').toLowerCase();
    if (CATEGORY_BY_SLUG.has(slug)) return CATEGORY_BY_SLUG.get(slug);

    const name = fold(leaflet.store_name);
    if (/albert|billa|coop|globus|hruska|kaufland|lidl|makro|penny|tesco|terno|potrav/.test(name)) return 'food';
    if (/droger|rossmann|teta|\bdm\b/.test(name)) return 'drugstore';
    if (/alza|datart|planeo|elektro/.test(name)) return 'electronics';
    if (/lekar|benu|dr max|pilulka/.test(name)) return 'pharmacy';
    if (/super zoo|pet center|chovat/.test(name)) return 'pets';
    if (/sportisimo|takko|pepco|\bkik\b|c&a|moda|oblecen/.test(name)) return 'fashion';
    if (/auto kelly|autokelly/.test(name)) return 'auto';
    if (/bauhaus|hornbach|mountfield|obi|jysk|ikea|mobelix|sconto|action|tedi|domac|nabytek|zahrad/.test(name)) return 'home';
    return 'other';
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function rest(table, params = {}) {
    const query = new URLSearchParams(params);
    const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'default',
    }, 10000);
    if (!response.ok) throw new Error(`Databáze vrátila HTTP ${response.status}.`);
    return response.json();
  }

  async function fastLeaflets() {
    const response = await fetchWithTimeout(PUBLIC_FEED, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type':'application/json', accept:'application/json' },
      body: JSON.stringify({ p_limit: 240 }),
      cache: 'default',
    }, 10000);
    if (!response.ok) throw new Error(`Veřejný feed letáků vrátil HTTP ${response.status}.`);
    const rows = await response.json();
    return currentLeaflets(Array.isArray(rows) ? rows : [])
      .filter((leaflet) => leaflet?.store_slug && leaflet?.store_name && leaflet?.preview_url)
      .map((leaflet) => ({
        ...leaflet,
        key: leaflet.leaflet_key || leaflet.key || null,
        category: categoryFor(leaflet),
      }));
  }

  async function activeStores() {
    return rest('stores', {
      select: 'id,slug,name,logo_url',
      is_active: 'eq.true',
      order: 'name.asc',
    });
  }

  function currentLeaflets(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : [])
      .filter((leaflet) => leaflet?.preview_url)
      .filter((leaflet) => !leaflet.valid_from || leaflet.valid_from <= TODAY)
      .filter((leaflet) => !leaflet.valid_to || leaflet.valid_to >= TODAY)
      .sort((a, b) => {
        const priority = (item) => item?.key === 'hypermarket' ? 0 : item?.key === 'supermarket' ? 1 : 2;
        return priority(a) - priority(b)
          || String(a.valid_to || '9999-12-31').localeCompare(String(b.valid_to || '9999-12-31'))
          || String(a.title || '').localeCompare(String(b.title || ''), 'cs');
      })
      .filter((leaflet) => {
        const key = String(leaflet.preview_url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  async function leafletsForStore(store) {
    const endpoint = `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(store.slug)}&source=all-leaflets-page-v1`;
    const response = await fetchWithTimeout(endpoint, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'default',
    }, 6000);
    if (!response.ok) throw new Error(`${store.slug}: HTTP ${response.status}`);
    const payload = await response.json();
    return currentLeaflets(payload?.leaflets).map((leaflet) => {
      const merged = {
        store_slug: store.slug,
        store_name: store.name,
        logo_url: leaflet.logo_url || store.logo_url || LOCAL_LOGOS[store.slug] || null,
        title: leaflet.title || 'Aktuální leták',
        leaflet_key: leaflet.key || null,
        valid_from: leaflet.valid_from || null,
        valid_to: leaflet.valid_to || null,
        preview_url: String(leaflet.preview_url),
      };
      merged.category = categoryFor(merged);
      return merged;
    });
  }

  async function allStoreLeaflets() {
    const stores = (await activeStores()).filter((store) => store?.slug);
    const results = [];
    let cursor = 0;
    const workerCount = Math.min(12, stores.length);

    async function worker() {
      while (cursor < stores.length) {
        const store = stores[cursor++];
        try {
          results.push(...await leafletsForStore(store));
        } catch (error) {
          console.debug('Letáky obchodu přeskočeny:', store.slug, error);
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  function sortLeaflets(items) {
    return [...items].sort((a, b) => {
      const categoryA = CATEGORY_DEFS.findIndex((category) => category.key === a.category);
      const categoryB = CATEGORY_DEFS.findIndex((category) => category.key === b.category);
      return categoryA - categoryB
        || String(a.store_name || '').localeCompare(String(b.store_name || ''), 'cs')
        || String(a.leaflet_key || '').localeCompare(String(b.leaflet_key || ''), 'cs')
        || String(a.valid_to || '').localeCompare(String(b.valid_to || ''));
    });
  }

  function logoMarkup(leaflet) {
    const logo = leaflet.logo_url || LOCAL_LOGOS[leaflet.store_slug];
    if (logo) return `<img src="${esc(logo)}" alt="Logo ${esc(leaflet.store_name)}" loading="lazy" decoding="async">`;
    return '<span class="allLeafletStoreMark" aria-hidden="true">%</span>';
  }

  function placeholderMarkup(leaflet) {
    const logo = leaflet.logo_url || LOCAL_LOGOS[leaflet.store_slug];
    return `<div class="allLeafletCoverPlaceholder">
      ${logo ? `<img src="${esc(logo)}" alt="" aria-hidden="true">` : '<span aria-hidden="true">▤</span>'}
      <small>Načítám titulní stranu</small>
    </div>`;
  }

  function cardMarkup(leaflet, index) {
    return `<article class="allLeafletCard" data-leaflet-index="${index}" data-preview-url="${esc(leaflet.preview_url)}">
      <div class="allLeafletCover" data-cover-slot>
        ${placeholderMarkup(leaflet)}
        <span class="allLeafletBadge">Aktuální leták</span>
      </div>
      <div class="allLeafletBody">
        <div class="allLeafletStore">${logoMarkup(leaflet)}<strong>${esc(leaflet.store_name)}</strong></div>
        <h3>${esc(leaflet.title || 'Aktuální leták')}</h3>
        <div class="allLeafletValidity">${esc(validityText(leaflet))}</div>
        <div class="allLeafletActions">
          <button class="allLeafletOpen" type="button" data-open-leaflet="${index}">Prolistovat leták ↗</button>
          <a class="allLeafletStoreLink" href="${encodeURIComponent(leaflet.store_slug)}.html" aria-label="Otevřít obchod ${esc(leaflet.store_name)}">›</a>
        </div>
      </div>
    </article>`;
  }

  function render(items) {
    if (!gridRoot || !chipRoot) return;
    const grouped = new Map(CATEGORY_DEFS.map((category) => [category.key, []]));
    items.forEach((leaflet, index) => {
      leaflet.__renderIndex = index;
      const category = grouped.has(leaflet.category) ? leaflet.category : 'other';
      grouped.get(category).push(leaflet);
    });

    const activeCategories = CATEGORY_DEFS.filter((category) => grouped.get(category.key)?.length);
    if (!activeCategories.length) return;

    totalNode && (totalNode.textContent = String(items.length));
    storeNode && (storeNode.textContent = String(new Set(items.map((item) => item.store_slug)).size));

    chipRoot.innerHTML = activeCategories.map((category) => {
      const count = grouped.get(category.key).length;
      return `<a class="leafletCategoryChip" href="#cat-${esc(category.key)}"><span>${category.icon}</span>${esc(category.name)}<b>${count}</b></a>`;
    }).join('');

    gridRoot.innerHTML = activeCategories.map((category) => {
      const leaflets = grouped.get(category.key);
      return `<section class="leafletCategorySection" id="cat-${esc(category.key)}">
        <div class="leafletCategoryHead">
          <div class="leafletCategoryTitle"><span class="leafletCategoryIcon" aria-hidden="true">${category.icon}</span><div><h2>${esc(category.name)}</h2><small>Aktuální letáky</small></div></div>
          <span class="leafletCategoryCount">${leaflets.length}</span>
        </div>
        <div class="leafletCategoryGrid">${leaflets.map((leaflet) => cardMarkup(leaflet, leaflet.__renderIndex)).join('')}</div>
      </section>`;
    }).join('');

    setupCoverObserver(items);
  }

  async function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = (async () => {
        let lastError = null;
        for (const source of PDF_SOURCES) {
          try {
            const module = await import(source.module);
            module.GlobalWorkerOptions.workerSrc = source.worker;
            return module;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('PDF.js není dostupné.');
      })();
    }
    return pdfjsPromise;
  }

  function isPdf(blob, bytes) {
    if (String(blob.type || '').toLowerCase().includes('pdf')) return true;
    return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }

  async function rawDocumentBlob(previewUrl) {
    if (documentPromises.has(previewUrl)) return documentPromises.get(previewUrl);

    const promise = (async () => {
      let response = await fetchWithTimeout(previewUrl, {
        headers: { apikey: SUPABASE_KEY, accept:'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
        cache: 'default',
      }, 24000);
      if (!response.ok) throw new Error(`Dokument vrátil HTTP ${response.status}.`);

      if (String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        const payload = await response.json();
        const redirectedUrl = String(payload?.url || '');
        if (!redirectedUrl.startsWith('https://')) throw new Error(payload?.error || 'Leták nevrátil dokument.');
        response = await fetchWithTimeout(redirectedUrl, {
          headers: { accept:'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8' },
          cache: 'default',
        }, 24000);
        if (!response.ok) throw new Error(`Soubor letáku vrátil HTTP ${response.status}.`);
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error('Dokument letáku je prázdný.');
      return blob;
    })();

    documentPromises.set(previewUrl, promise);
    promise.catch(() => documentPromises.delete(previewUrl));
    return promise;
  }

  async function cacheRequest(sourceUrl) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceUrl));
    const hash = Array.from(new Uint8Array(digest)).slice(0, 16).map((value) => value.toString(16).padStart(2, '0')).join('');
    return new Request(new URL(`/__slevao_all_leaflet__/${hash}`, location.origin));
  }

  async function cachedCover(sourceUrl) {
    if (!('caches' in window) || !crypto?.subtle) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(await cacheRequest(sourceUrl));
      return response?.ok ? response.blob() : null;
    } catch {
      return null;
    }
  }

  async function saveCover(sourceUrl, blob) {
    if (!('caches' in window) || !crypto?.subtle) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(await cacheRequest(sourceUrl), new Response(blob, { headers:{ 'content-type':blob.type || 'image/webp' } }));
    } catch {}
  }

  async function renderFirstPage(documentBlob) {
    const bytes = new Uint8Array(await documentBlob.arrayBuffer());
    if (!isPdf(documentBlob, bytes)) {
      if (!String(documentBlob.type || '').startsWith('image/')) throw new Error('Nepodporovaný typ letáku.');
      return documentBlob;
    }

    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data:bytes, isEvalSupported:false, useWorkerFetch:true }).promise;
    try {
      const page = await pdf.getPage(1);
      const natural = page.getViewport({ scale:1 });
      const desiredWidth = window.innerWidth <= 800 ? 300 : 430;
      const viewport = page.getViewport({ scale:Math.min(1.8, desiredWidth / natural.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha:false });
      if (!context) throw new Error('Náhled nelze vykreslit.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext:context, viewport }).promise;
      const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .84));
      if (webp) return webp;
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('Náhled se nepodařilo vytvořit.');
      return png;
    } finally {
      await pdf.destroy();
    }
  }

  async function coverBlob(previewUrl) {
    const cached = await cachedCover(previewUrl);
    if (cached) return cached;
    const cover = await renderFirstPage(await rawDocumentBlob(previewUrl));
    saveCover(previewUrl, cover);
    return cover;
  }

  async function renderCardCover(card) {
    if (!card || card.dataset.coverLoaded === '1') return;
    card.dataset.coverLoaded = 'loading';
    const previewUrl = card.dataset.previewUrl;
    const slot = card.querySelector('[data-cover-slot]');
    if (!previewUrl || !slot) return;
    try {
      const blob = await coverBlob(previewUrl);
      if (!card.isConnected) return;
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.add(objectUrl);
      const placeholder = slot.querySelector('.allLeafletCoverPlaceholder');
      placeholder?.remove();
      const image = document.createElement('img');
      image.className = 'leafletPageImage';
      image.src = objectUrl;
      image.alt = 'Titulní strana letáku';
      image.decoding = 'async';
      slot.prepend(image);
      card.dataset.coverLoaded = '1';
    } catch (error) {
      card.dataset.coverLoaded = 'error';
      const hint = slot.querySelector('.allLeafletCoverPlaceholder small');
      if (hint) hint.textContent = 'Náhled není dostupný';
    }
  }

  function setupCoverObserver(items) {
    coverObserver?.disconnect();
    const cards = [...document.querySelectorAll('.allLeafletCard')];
    if (!('IntersectionObserver' in window)) {
      cards.slice(0, 10).forEach(renderCardCover);
      return;
    }
    coverObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        coverObserver.unobserve(entry.target);
        renderCardCover(entry.target);
      });
    }, { rootMargin:'500px 0px' });
    cards.forEach((card) => coverObserver.observe(card));
  }

  async function openLeaflet(index, button) {
    const items = window.__slevaoAllLeaflets || [];
    const leaflet = items[index];
    if (!leaflet?.preview_url) return;

    const popup = window.open('about:blank', '_blank');
    if (popup) {
      try { popup.opener = null; } catch {}
      try { popup.document.title = 'Načítám leták…'; } catch {}
    }
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = 'Otevírám…';

    try {
      const blob = await rawDocumentBlob(leaflet.preview_url);
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.add(objectUrl);
      const target = isPdf(blob, new Uint8Array(await blob.slice(0, 4).arrayBuffer())) ? `${objectUrl}#page=1&zoom=page-fit` : objectUrl;
      if (popup && !popup.closed) popup.location.replace(target);
      else window.location.href = target;
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      window.alert('Leták se teď nepodařilo otevřít. Zkus to prosím znovu.');
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-leaflet]');
    if (!button) return;
    const index = Number(button.dataset.openLeaflet);
    if (!Number.isInteger(index)) return;
    openLeaflet(index, button);
  });

  async function boot() {
    if (!gridRoot) return;

    try {
      const canonicalItems = await fastLeaflets();
      if (canonicalItems.length) {
        window.__slevaoAllLeaflets = sortLeaflets(canonicalItems);
        render(window.__slevaoAllLeaflets);
        return;
      }
      throw new Error('Veřejný feed nevrátil žádný aktuální leták.');
    } catch (canonicalError) {
      console.warn('Kanonický feed letáků není dostupný, používám nouzový fallback:', canonicalError);
    }

    try {
      const fallbackItems = await allStoreLeaflets();
      if (!fallbackItems.length) throw new Error('Nebyl nalezen žádný aktuální leták.');
      window.__slevaoAllLeaflets = sortLeaflets(fallbackItems);
      render(window.__slevaoAllLeaflets);
    } catch (error) {
      gridRoot.innerHTML = `<div class="leafletsEmpty"><strong>Aktuální letáky se nepodařilo načíst</strong><span>Zkus stránku za chvíli obnovit.</span></div>`;
      console.error('All leaflets page failed:', error);
    }
  }

  window.addEventListener('pagehide', () => {
    coverObserver?.disconnect();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();