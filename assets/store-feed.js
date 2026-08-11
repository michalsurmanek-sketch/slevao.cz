(() => {
  const config = window.SLEVAO_STORE || {};
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FAVORITES_KEY = 'slevao-favorite-offers-v1';
  const OFFICIAL_TESCO_LEAFLETS = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';

  // Jediný zdroj vizuální identity obchodů. Logo se bere z databáze; pokud
  // zatím chybí, použije se ikona z oficiální domény. Textový logotyp je až
  // poslední, vždy čitelná záloha při blokování externího obrázku.
  const BRAND_PROFILES = {
    action:['action.com','#0050aa','#ffd500','home'],albert:['albert.cz','#52a52f','#ffdd00','grocery'],alza:['alza.cz','#73b928','#1167a8','electronics'],
    asko:['asko-nabytek.cz','#e30613','#ffd200','home'],'auto-kelly':['autokelly.cz','#cf132d','#ffd100','automotive'],bauhaus:['bauhaus.cz','#e30613','#ffffff','home'],
    benu:['benu.cz','#61a60e','#003b70','pharmacy'],billa:['billa.cz','#f7d417','#d71920','grocery'],brnenka:['brnenka.cz','#e31e24','#f4c430','grocery'],
    ca:['c-and-a.com','#c8102e','#ffffff','fashion'],cba:['cba.cz','#e31837','#005baa','grocery'],coop:['coop.cz','#e31e24','#ffd400','grocery'],
    cropp:['cropp.com','#111111','#f04f23','fashion'],datart:['datart.cz','#e30613','#ffd400','electronics'],decathlon:['decathlon.cz','#007dbc','#ffffff','sport'],
    dek:['dek.cz','#f58220','#1e3a5f','home'],dm:['dm.cz','#003b7a','#e30613','drugstore'],'dr-max':['drmax.cz','#00843d','#ffffff','pharmacy'],
    enapo:['enapo.cz','#e30613','#ffd400','grocery'],'eso-market':['esomarket.cz','#e30613','#ffd400','grocery'],flop:['flop-potraviny.cz','#e30613','#ffd400','grocery'],
    globus:['globus.cz','#d71920','#ffcf00','grocery'],hm:['hm.com','#e50010','#ffffff','fashion'],hornbach:['hornbach.cz','#f58220','#222222','home'],
    house:['housebrand.com','#111111','#f5f5f5','fashion'],hruska:['mojehruska.cz','#e30613','#74b82a','grocery'],ikea:['ikea.com','#0058a3','#ffda1a','home'],
    intersport:['intersport.cz','#e30613','#005baa','sport'],jednota:['jednota.cz','#e31e24','#ffd400','grocery'],jip:['jip-potraviny.cz','#d71920','#f9c400','grocery'],
    jysk:['jysk.cz','#0058a3','#ffffff','home'],kaufland:['kaufland.cz','#e30613','#003b70','grocery'],kik:['kik.cz','#e30613','#ffd200','fashion'],
    konzum:['konzumuo.cz','#e31e24','#ffd400','grocery'],kosik:['kosik.cz','#f05a28','#6d2077','online'],kubik:['kubik.cz','#e30613','#ffd400','grocery'],
    lidl:['lidl.cz','#0050aa','#ffdd00','grocery'],makro:['makro.cz','#0066b3','#ffdd00','grocery'],moebelix:['moebelix.cz','#e30613','#ffdf00','home'],
    mountfield:['mountfield.cz','#00843d','#ffd400','home'],'new-yorker':['newyorker.de','#111111','#ffffff','fashion'],norma:['norma-online.de','#005ca9','#ffd500','grocery'],
    obi:['obi.cz','#f58220','#1d1d1b','home'],okay:['okay.cz','#e30613','#ffd400','electronics'],penny:['penny.cz','#d71920','#ffd400','grocery'],
    pepco:['pepco.cz','#003b7a','#e30613','fashion'],petcenter:['petcenter.cz','#e30613','#ffd400','pets'],pilulka:['pilulka.cz','#e6007e','#7b2d8e','pharmacy'],
    planeo:['planeo.cz','#e30613','#ffd400','electronics'],'potraviny-muj-obchod':['mujobchod.cz','#e31e24','#f7c600','grocery'],'pramen-cz':['pramen.cz','#005ca9','#e31e24','grocery'],
    'pro-doma':['pro-doma.cz','#e30613','#1d3660','home'],ratio:['ratio.cz','#005ca9','#ffd400','grocery'],reserved:['reserved.com','#111111','#f1f1f1','fashion'],
    rohlik:['rohlik.cz','#6f2c91','#f4b223','online'],'rosa-market':['rosamarket.cz','#d71920','#8dc63f','grocery'],rossmann:['rossmann.cz','#e30613','#ffffff','drugstore'],
    sconto:['sconto.cz','#e30613','#ffd400','home'],sinsay:['sinsay.com','#111111','#f5b9c8','fashion'],smarty:['smarty.cz','#111111','#8bc53f','electronics'],
    sportisimo:['sportisimo.cz','#e30613','#005baa','sport'],stavmat:['stavmat.cz','#005ca9','#f58220','home'],'super-zoo':['superzoo.cz','#74b82a','#f58220','pets'],
    takko:['takko.com','#e30613','#111111','fashion'],tamda:['tamdafoods.eu','#d71920','#ffd400','grocery'],tedi:['tedi.com','#e30613','#005baa','home'],
    tempo:['tempo.cz','#e31e24','#ffd400','grocery'],terno:['terno.cz','#00843d','#f5c400','grocery'],tesco:['itesco.cz','#00539f','#e31837','grocery'],
    teta:['tetadrogerie.cz','#e6007e','#ffffff','drugstore'],trefa:['trefa.cz','#e31e24','#ffd400','grocery'],xxxlutz:['xxxlutz.cz','#e30613','#ffd400','home'],
    zabka:['zabka.cz','#74b82a','#ffd400','grocery'],
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const price = (offer) => Number(offer.price || 0);
  const old = (offer) => Number(offer.old_price || 0);
  const saving = (offer) => Math.max(0, old(offer) - price(offer));
  const discount = (offer) => old(offer) > price(offer) ? Math.round(saving(offer) / old(offer) * 100) : 0;
  const format = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : '';
  const formatLong = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : '';

  let offers = [];
  let visible = 24;
  let store = null;
  let loading = false;
  let activeCategory = 'all';
  let showSaved = false;
  let favorites = readFavorites();
  let leafletObjectUrl = '';
  let leafletLoadController = null;

  function brandProfile() {
    const [domain = '', primary = '#0b6f68', accent = '#12b8a6', family = 'grocery'] = BRAND_PROFILES[config.slug] || [];
    return { domain, primary, accent, family };
  }

  function applyBrandShell(storeData = null) {
    const profile = brandProfile();
    const primary = config.color || storeData?.primary_color || profile.primary;
    const name = storeData?.name || config.name || 'Obchod';
    document.documentElement.style.setProperty('--store', primary);
    document.documentElement.style.setProperty('--store-accent', profile.accent);
    const hex = String(primary).match(/^#([\da-f]{6})$/i)?.[1];
    const luminance = hex ? (0.299 * parseInt(hex.slice(0, 2), 16) + 0.587 * parseInt(hex.slice(2, 4), 16) + 0.114 * parseInt(hex.slice(4, 6), 16)) : 0;
    document.documentElement.style.setProperty('--store-on', luminance > 165 ? '#13201f' : '#ffffff');
    document.body.dataset.store = config.slug || 'obchod';
    document.body.dataset.storeFamily = profile.family;
    if (config.slug !== 'tesco') document.body.classList.add('store-page--brand');
    const hero = document.querySelector('.heroBox');
    if (hero && config.slug !== 'tesco') {
      hero.dataset.brandName = name;
      hero.dataset.brandDomain = profile.domain;
      if (!hero.querySelector('.brandKicker')) {
        const kicker = document.createElement('span');
        kicker.className = 'brandKicker';
        kicker.textContent = 'OFICIÁLNÍ AKČNÍ NABÍDKY';
        hero.querySelector('h1')?.before(kicker);
      }
    }
    $('titleName') && ($('titleName').textContent = name);
    const image = $('storeLogo');
    if (!image) return;
    let wordmark = $('storeWordmark');
    if (!wordmark && config.slug !== 'tesco') {
      wordmark = document.createElement('strong');
      wordmark.id = 'storeWordmark';
      wordmark.className = 'storeWordmark';
      wordmark.textContent = name;
      image.after(wordmark);
    }
    if (config.slug === 'tesco') return;
    const candidates = [...new Set([
      config.logo,
      storeData?.logo_url,
      profile.domain ? `https://www.google.com/s2/favicons?sz=256&domain_url=https://${profile.domain}` : '',
    ].filter(Boolean))];
    let index = 0;
    image.hidden = true;
    if (wordmark) wordmark.hidden = false;
    const next = () => {
      if (index >= candidates.length) return;
      image.src = candidates[index++];
    };
    image.onload = () => { image.hidden = false; if (wordmark) wordmark.hidden = true; };
    image.onerror = () => { image.hidden = true; if (wordmark) wordmark.hidden = false; next(); };
    next();
  }

  function fitLeafletViewer() {
    const frame = $('leafletFrame');
    if (!frame || frame.hidden) return;
    const top = Math.max(frame.getBoundingClientRect().top, innerWidth <= 520 ? 76 : 96);
    const minimum = innerWidth <= 520 ? 360 : 420;
    frame.style.height = `${Math.max(minimum, Math.min(900, innerHeight - top - 12))}px`;
  }

  function readFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); } catch { /* Storage can be disabled. */ }
  }

  const request = async (table, params) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`, {
        headers: { apikey: KEY },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Databáze odpověděla chybou ${response.status}.`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const unique = (rows) => [...new Map(rows.map((offer) => [
    [fold(offer.title), offer.valid_from, offer.valid_to].join('|'), offer,
  ])).values()];

  function searchableText(offer) {
    const productName = Array.isArray(offer.products) ? offer.products[0]?.name : offer.products?.name;
    return fold([offer.title, productName].join(' '));
  }

  function categoryFor(offer) {
    const text = searchableText(offer);
    if (/(pes|kock|granul|konzerv.*zvir|mazlic|steliv|whiskas|pedigree|purina)/.test(text)) return 'pets';
    if (/(napoj|voda|pivo|vino|dzus|juice|cola|limonad|sirup|kava|caj|energy)/.test(text)) return 'drinks';
    if (/(praci|avivaz|sampon|sprch|mydlo|zubni|drogeri|toalet|kosmetik|deodor|cistic|tablety do mycky)/.test(text)) return 'drugstore';
    if (/(domac|nadobi|hrnec|panev|rucnik|povlec|baterie|zarov|papirnict|zahrad|naradi)/.test(text)) return 'home';
    return 'food';
  }

  function updateFavoriteControls() {
    if ($('savedCount')) $('savedCount').textContent = favorites.size.toLocaleString('cs-CZ');
    if ($('savedToggle')) {
      $('savedToggle').classList.toggle('active', showSaved);
      $('savedToggle').setAttribute('aria-pressed', String(showSaved));
    }
  }

  function leafletCard(leaflet) {
    const url = /^https:\/\//.test(String(leaflet.url || '')) ? leaflet.url : OFFICIAL_TESCO_LEAFLETS;
    const previewUrl = String(leaflet.preview_url || '');
    const safeRossmannEmbed = String(leaflet.embed_url || '').startsWith('https://publikace.rossmann.cz/') ? String(leaflet.embed_url) : '';
    const externalViewer = /^https:\/\/www\.jip-potraviny\.cz\/wp-content\/uploads\/file\//i.test(url);
    const storeSlug = String(config.slug || '').toLowerCase();
    const isExternalWebOffer = ['pepco', 'petcenter', 'planeo'].includes(storeSlug);
    const canPreview = Boolean(safeRossmannEmbed) || (!isExternalWebOffer && !externalViewer && previewUrl.startsWith(`${SUPABASE_URL}/functions/v1/store-leaflet-document?`));
    const rawLogo = String(leaflet.logo_url || config.logo || store?.logo_url || '');
    const logo = /^(?:https:\/\/|assets\/)/.test(rawLogo) ? rawLogo : '';
    const validity = leaflet.valid_from && leaflet.valid_to
      ? `${formatLong(leaflet.valid_from)} – ${formatLong(leaflet.valid_to)}`
      : 'Aktuální platnost ověříš po otevření';
    const open = canPreview
      ? `<button class="leafletCard" type="button" data-leaflet-preview="${esc(safeRossmannEmbed || previewUrl)}" data-leaflet-title="${esc(leaflet.subtitle || leaflet.title || 'Tesco leták')}">`
      : `<a class="leafletCard" href="${esc(url)}" target="_blank" rel="noopener noreferrer">`;
    const close = canPreview ? '</button>' : '</a>';
    const leafletType = /katalog/i.test(String(leaflet.title || '')) || leaflet.key === 'catalog' ? 'Katalog' : 'Akční leták';
    return `${open}
      <div class="leafletCover">
        ${logo ? `<img src="${esc(logo)}" alt="" aria-hidden="true">` : `<strong class="leafletBrand">${esc((config.name || leaflet.subtitle || 'S').slice(0, 3).toUpperCase())}</strong>`}
        <span>${esc(leaflet.subtitle || config.name || 'Obchod')}</span>
      </div>
      <div class="leafletBody">
        <span class="leafletType">${leafletType}</span>
        <h3>${esc(leaflet.subtitle || leaflet.title || `${config.name || 'Obchod'} leták`)}</h3>
        <p>${esc(leaflet.title || 'Aktuální nabídka')}</p>
        <div class="leafletValidity">Platí ${esc(validity)}</div>
        <span class="leafletAction">${canPreview ? 'Prolistovat přímo zde' : (storeSlug === 'pepco' ? 'Prohlédnout nabídku na Pepco.cz ↗' : (storeSlug === 'petcenter' ? 'Prohlédnout výprodej na PetCenter.cz ↗' : (storeSlug === 'planeo' ? 'Prohlédnout akce na Planeo.cz ↗' : (storeSlug === 'rossmann' ? 'Prohlédnout akce na Rossmann.cz ↗' : 'Otevřít oficiální leták'))))}</span>
      </div>
    ${close}`;
  }

  async function openLeafletViewer(previewUrl, title, shouldScroll = true) {
    const viewer = $('leafletViewer');
    const frame = $('leafletFrame');
    const isRossmannEmbed = String(config.slug || '').toLowerCase() === 'rossmann' && previewUrl.startsWith('https://publikace.rossmann.cz/');
    if (!viewer || !frame || (!isRossmannEmbed && !previewUrl.startsWith(`${SUPABASE_URL}/functions/v1/store-leaflet-document?`))) return;
    leafletLoadController?.abort();
    leafletLoadController = new AbortController();
    if (leafletObjectUrl) URL.revokeObjectURL(leafletObjectUrl);
    leafletObjectUrl = '';
    $('leafletViewerTitle').textContent = title || `${config.name || 'Obchod'} leták`;
    $('leafletViewerStatus').hidden = false;
    $('leafletViewerStatus').textContent = 'Načítám leták…';
    $('leafletViewerStatus').className = 'leafletViewerStatus loading';
    frame.removeAttribute('src');
    frame.hidden = true;
    viewer.hidden = false;
    const mobileViewer = matchMedia('(max-width: 820px)').matches;
    document.body.classList.toggle('leaflet-viewer-open', mobileViewer);
    $('leafletGrid')?.querySelectorAll('[data-leaflet-preview]').forEach((button) => {
      button.classList.toggle('active', button.dataset.leafletPreview === previewUrl);
    });
    if (shouldScroll && !mobileViewer) viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (isRossmannEmbed) {
      frame.src = previewUrl;
      frame.hidden = false;
      requestAnimationFrame(fitLeafletViewer);
      setTimeout(fitLeafletViewer, 450);
      $('leafletViewerStatus').hidden = true;
      return;
    }
    try {
      const response = await fetch(previewUrl, {
        headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
        signal: leafletLoadController.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
      }
      let payload = null;
      try {
        payload = await response.clone().json();
      } catch {
        // Binární odpověď (PDF/WebP) pokračuje do blob větve níže.
      }
      if (payload && typeof payload === 'object') {
        const signedUrl = String(payload.url || '');
        if (!signedUrl.startsWith(`${SUPABASE_URL}/storage/v1/object/sign/`)) throw new Error(payload.error || 'Neplatný odkaz na leták.');
        frame.src = `${signedUrl}#page=1&zoom=page-fit`;
        frame.hidden = false;
        requestAnimationFrame(fitLeafletViewer);
        setTimeout(fitLeafletViewer, 450);
        $('leafletViewerStatus').hidden = true;
        return;
      }
      const documentBlob = await response.blob();
      if (!documentBlob.size) throw new Error('Stažený leták je prázdný.');
      const contentType = String(response.headers.get('content-type') || documentBlob.type || '').toLowerCase();
      const signature = new Uint8Array(await documentBlob.slice(0, 12).arrayBuffer());
      const isPdf = signature[0] === 0x25 && signature[1] === 0x50 && signature[2] === 0x44 && signature[3] === 0x46;
      const isPng = signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47;
      const isJpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
      const isWebp = signature[0] === 0x52 && signature[1] === 0x49 && signature[2] === 0x46 && signature[3] === 0x46
        && signature[8] === 0x57 && signature[9] === 0x45 && signature[10] === 0x42 && signature[11] === 0x50;
      if (/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType) || (!isPdf && !isPng && !isJpeg && !isWebp)) {
        throw new Error('Zdroj nevrátil skutečný PDF nebo obrázkový leták.');
      }
      leafletObjectUrl = URL.createObjectURL(documentBlob);
      frame.src = `${leafletObjectUrl}#page=1&zoom=page-fit`;
      frame.hidden = false;
      requestAnimationFrame(fitLeafletViewer);
      setTimeout(fitLeafletViewer, 450);
      $('leafletViewerStatus').hidden = true;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      $('leafletViewerStatus').hidden = false;
      $('leafletViewerStatus').className = 'leafletViewerStatus error';
      $('leafletViewerStatus').innerHTML = `<strong>Leták se nepodařilo zobrazit.</strong><span>${esc(error?.message || 'Zkus to prosím znovu.')}</span>`;
    }
  }

  async function loadLeaflets(autoOpen = true) {
    const target = $('leafletGrid');
    if (!target) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(config.slug || '')}&source=official-v8`, {
        headers: { apikey: KEY },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!Array.isArray(result.leaflets) || !result.leaflets.length) throw new Error('Bez aktuálních letáků');
      const currentLeaflets = result.leaflets.slice(0, 20);
      target.dataset.count = String(currentLeaflets.length);
      target.innerHTML = currentLeaflets.map(leafletCard).join('');
      target.querySelectorAll('[data-leaflet-preview]').forEach((button) => button.addEventListener('click', () => {
        openLeafletViewer(button.dataset.leafletPreview, button.dataset.leafletTitle);
      }));
      const firstPreview = target.querySelector('[data-leaflet-preview]');
      if (autoOpen && firstPreview && !matchMedia('(max-width: 820px)').matches) {
        openLeafletViewer(firstPreview.dataset.leafletPreview, firstPreview.dataset.leafletTitle, false);
      }
    } catch {
      target.dataset.count = '1';
      target.innerHTML = config.slug === 'tesco'
        ? `<a class="leafletCard" href="${OFFICIAL_TESCO_LEAFLETS}" target="_blank" rel="noopener noreferrer"><div class="leafletCover"><img src="assets/logos/tesco.svg" alt="" aria-hidden="true"><span>Aktuální letáky</span></div><div class="leafletBody"><span class="leafletType">Oficiální zdroj</span><h3>Letáky a katalogy Tesco</h3><p>Prohlédni si právě platnou nabídku podle své prodejny.</p><span class="leafletAction">Otevřít iTesco</span></div></a>`
        : `<div class="leafletError"><strong>Aktuální leták zatím není dostupný.</strong><br>Jakmile automatický import získá nový platný dokument, zobrazí se zde.</div>`;
    } finally {
      clearTimeout(timer);
    }
  }

  function filteredOffers() {
    const query = fold($('q').value);
    const sort = $('sort').value;
    const rows = offers.filter((offer) => {
      if (query && !searchableText(offer).includes(query)) return false;
      if (activeCategory !== 'all' && categoryFor(offer) !== activeCategory) return false;
      return !showSaved || favorites.has(String(offer.id));
    });
    rows.sort((a, b) => sort === 'discount' ? discount(b) - discount(a)
      : sort === 'saving' ? saving(b) - saving(a)
        : sort === 'price' ? price(a) - price(b)
          : sort === 'name' ? String(a.title).localeCompare(String(b.title), 'cs')
            : 0);
    return rows;
  }

  function leafletLocation(offer) {
    const page = Number(offer?.metadata?.leaflet_page || 0);
    const documentUrl = String(offer?.metadata?.leaflet_document_url || '');
    if (!Number.isInteger(page) || page < 1 || page > 500 || !/^https:\/\/.*\.pdf(?:\?|$)/i.test(documentUrl)) return null;
    return { page, url: `${documentUrl}#page=${page}&zoom=page-fit` };
  }

  function offerCard(offer) {
    const id = String(offer.id);
    const isFavorite = favorites.has(id);
    return `<article class="deal">
      <div class="media">
        ${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.title)}" loading="lazy" onerror="this.remove()">` : '🏷️'}
        ${discount(offer) ? `<span class="discount">−${discount(offer)} %</span>` : ''}
        ${$('savedToggle') ? `<button class="favorite${isFavorite ? ' active' : ''}" type="button" data-favorite="${esc(id)}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Odebrat z uložených' : 'Uložit nabídku'}">${isFavorite ? '♥' : '♡'}</button>` : ''}
      </div>
      <div class="body">
        <div class="storeName">${esc(store?.name || config.name)}</div>
        <h3>${esc(offer.title)}</h3>
        <div class="prices"><span class="price">${price(offer).toLocaleString('cs-CZ')} Kč</span>${old(offer) ? `<span class="old">${old(offer).toLocaleString('cs-CZ')} Kč</span>` : ''}</div>
        ${saving(offer) ? `<span class="saving">Ušetříš ${saving(offer).toLocaleString('cs-CZ')} Kč</span>` : ''}
        <div class="validity">Platí ${format(offer.valid_from)}–${format(offer.valid_to)}</div>
        ${leafletLocation(offer) ? `<a class="leafletLocationButton" href="${esc(leafletLocation(offer).url)}" target="_blank" rel="noopener noreferrer" aria-label="Ukázat produkt v letáku na straně ${leafletLocation(offer).page}"><span>📄</span> Leták · strana ${leafletLocation(offer).page}</a>` : ''}
      </div>
    </article>`;
  }

  function render() {
    const rows = filteredOffers();
    $('resultCount').textContent = showSaved
      ? `${rows.length} uložených nabídek`
      : `${rows.length} aktuálních nabídek`;
    $('grid').innerHTML = rows.length
      ? rows.slice(0, visible).map(offerCard).join('')
      : `<div class="empty"><strong>${showSaved ? 'Zatím nemáš uložené žádné nabídky' : 'Aktuálně tu nejsou žádné odpovídající nabídky'}</strong>${showSaved ? 'Ulož si produkt klepnutím na srdíčko.' : 'Zkus jinou kategorii nebo zruš hledání.'}</div>`;
    $('loadMore').hidden = rows.length <= visible;
    $('grid').querySelectorAll('[data-favorite]').forEach((button) => button.addEventListener('click', () => {
      const id = String(button.dataset.favorite);
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      saveFavorites();
      updateFavoriteControls();
      render();
    }));
  }

  function apply(storeData, rows, status) {
    store = storeData;
    offers = unique(rows).filter((offer) => offer.is_verified === true);
    applyBrandShell(store);
    $('status').textContent = status;
    $('offerCount').textContent = `${offers.length} nabídek`;
    $('updated').textContent = `Aktualizováno ${new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    updateFavoriteControls();
    render();
  }

  async function load() {
    if (loading) return;
    loading = true;
    $('status').textContent = 'Načítám aktuální leták…';
    try {
      const stores = await request('stores', {
        select: 'id,name,slug,logo_url,primary_color', slug: `eq.${config.slug}`, limit: '1',
      });
      if (!stores[0]) throw new Error('Obchod není v databázi aktivní.');
      const today = new Date().toISOString().slice(0, 10);
      const rows = await request('offers', {
        select: 'id,title,price,old_price,image_url,valid_from,valid_to,is_verified,metadata,products(name)',
        store_id: `eq.${stores[0].id}`,
        status: 'eq.published',
        is_verified: 'eq.true',
        valid_from:`lte.${today}`,
        valid_to:`gte.${today}`,
        order: 'published_at.desc',
      });
      apply(stores[0], rows, '● Živý feed');
    } catch (error) {
      $('status').textContent = 'Feed není dostupný';
      $('grid').innerHTML = `<div class="error"><strong>Nabídky se nepodařilo načíst</strong>${esc(error?.message || 'Zkus stránku obnovit.')}<br><button class="retry" id="retry">Zkusit znovu</button></div>`;
      $('retry')?.addEventListener('click', load);
    } finally {
      loading = false;
    }
  }

  applyBrandShell();
  $('q').addEventListener('input', () => { visible = 24; render(); });
  $('sort').addEventListener('change', () => { visible = 24; render(); });
  $('loadMore').addEventListener('click', () => { visible += 24; render(); });
  $('categoryBar')?.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    visible = 24;
    $('categoryBar').querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));
  $('savedToggle')?.addEventListener('click', () => { showSaved = !showSaved; visible = 24; updateFavoriteControls(); render(); });
  $('closeLeafletViewer')?.addEventListener('click', () => {
    leafletLoadController?.abort();
    if (leafletObjectUrl) URL.revokeObjectURL(leafletObjectUrl);
    leafletObjectUrl = '';
    document.body.classList.remove('leaflet-viewer-open');
    $('leafletViewer').hidden = true;
    $('leafletFrame').removeAttribute('src');
    $('leafletGrid')?.querySelectorAll('[data-leaflet-preview]').forEach((button) => button.classList.remove('active'));
  });
  window.addEventListener('online', load);
  window.addEventListener('resize', fitLeafletViewer);
  window.addEventListener('orientationchange', () => setTimeout(fitLeafletViewer, 150));
  load();
  loadLeaflets();
  setInterval(load,5*60*1000);
  setInterval(() => loadLeaflets(false),10*60*1000);
})();
