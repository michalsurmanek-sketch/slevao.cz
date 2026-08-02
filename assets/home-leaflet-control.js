(() => {
  'use strict';
  if (window.__slevaoLeafletControlLoaded) return;
  window.__slevaoLeafletControlLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const SETTINGS_URL = `${SUPABASE_URL}/storage/v1/object/public/homepage-leaflet-settings/visibility.json`;
  const LEGACY_IMAGE_BUCKET = 'homepage-leaflet-images';
  const COVER_KEY = 'slevao-cover';
  const VISIBILITY_KEY = 'slevao-leaflet-visibility';
  const FORCE_KEY = 'slevao-leaflet-force';

  let storeSettings = new Map();
  let legacyHidden = new Set();
  let loading = null;
  let scheduled = 0;
  let generation = 0;
  let applying = false;
  const imageChecks = new Map();

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function parseMeta(value) {
    const raw = String(value || '').trim();
    const index = raw.indexOf('#');
    return {
      base: index < 0 ? raw : raw.slice(0, index),
      params: index < 0 ? new URLSearchParams() : new URLSearchParams(raw.slice(index + 1)),
    };
  }

  function parseParams(value) {
    return parseMeta(value).params;
  }

  function slugFromCard(card) {
    const direct = String(card?.dataset?.storeSlug || '').trim().toLowerCase();
    if (direct) return direct;
    const href = card.querySelector('.leafletCoverLink[href],.leafletAction a[href]')?.getAttribute('href') || '';
    try {
      const path = new URL(href, document.baseURI).pathname;
      return decodeURIComponent(path.split('/').pop() || '').replace(/\.html$/i, '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  async function fetchStores() {
    const query = new URLSearchParams({
      select: 'slug,name,website_url,logo_url,is_active',
      is_active: 'eq.true',
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
      headers: { apikey: SUPABASE_KEY }, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Obchody vrátily HTTP ${response.status}.`);
    return response.json();
  }

  async function fetchLegacyVisibility() {
    try {
      const response = await fetch(`${SETTINGS_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (response.status === 404) return new Set();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return new Set((Array.isArray(payload?.hidden_slugs) ? payload.hidden_slugs : [])
        .map((slug) => String(slug || '').trim().toLowerCase()).filter(Boolean));
    } catch (error) {
      console.warn('Staré nastavení viditelnosti není dostupné:', error);
      return new Set();
    }
  }

  function normalizeStore(row) {
    const website = parseMeta(row?.website_url);
    const logo = parseMeta(row?.logo_url);
    const visibility = website.params.get(VISIBILITY_KEY) || logo.params.get(VISIBILITY_KEY) || '';
    const cover = website.params.get(COVER_KEY) || logo.params.get(COVER_KEY) || '';
    const force = website.params.get(FORCE_KEY) || logo.params.get(FORCE_KEY) || '';
    return {
      slug: String(row?.slug || '').trim().toLowerCase(),
      name: String(row?.name || row?.slug || '').trim(),
      logoUrl: logo.base,
      visibility: visibility === 'hidden' || visibility === 'visible' ? visibility : '',
      cover,
      force: force === '1',
    };
  }

  async function loadSettings(force = false) {
    if (loading && !force) return loading;
    loading = (async () => {
      const [rows, oldHidden] = await Promise.all([fetchStores(), fetchLegacyVisibility()]);
      const next = new Map();
      for (const row of rows || []) {
        const setting = normalizeStore(row);
        if (setting.slug) next.set(setting.slug, setting);
      }
      storeSettings = next;
      legacyHidden = oldHidden;
      generation += 1;
      imageChecks.clear();
    })().catch((error) => {
      console.warn('Nastavení karet letáků se nepodařilo načíst:', error);
    }).finally(() => {
      loading = null;
    });
    return loading;
  }

  function isHidden(slug, settings) {
    if (settings?.visibility === 'hidden') return true;
    if (settings?.visibility === 'visible') return false;
    return legacyHidden.has(slug);
  }

  function legacyImageUrl(slug) {
    return `${SUPABASE_URL}/storage/v1/object/public/${LEGACY_IMAGE_BUCKET}/${encodeURIComponent(slug)}/cover?v=${generation}`;
  }

  function probeImage(url, key) {
    if (!url || url === 'none') return Promise.resolve('');
    if (imageChecks.has(key)) return imageChecks.get(key);
    const promise = new Promise((resolve) => {
      const image = new Image();
      const timer = window.setTimeout(() => resolve(''), 7000);
      image.onload = () => { window.clearTimeout(timer); resolve(url); };
      image.onerror = () => { window.clearTimeout(timer); resolve(''); };
      image.src = `${url}${url.includes('?') ? '&' : '?'}slevao_card=${generation}-${Date.now()}`;
    });
    imageChecks.set(key, promise);
    return promise;
  }

  async function desiredImage(slug, settings) {
    if (settings?.cover === 'none') return '';
    if (/^https:\/\//i.test(settings?.cover || '')) {
      return probeImage(settings.cover, `mapped:${slug}:${settings.cover}`);
    }
    return probeImage(legacyImageUrl(slug), `legacy:${slug}:${generation}`);
  }

  function rememberAutomaticImage(image) {
    const current = image.currentSrc || image.src || '';
    const manual = image.dataset.manualLeafletUrl || '';
    if (!image.dataset.automaticLeafletSrc || (current && current !== manual && current !== image.dataset.automaticLeafletSrc)) {
      image.dataset.automaticLeafletSrc = current;
    }
  }

  function restoreAutomatic(card, image) {
    const original = image.dataset.automaticLeafletSrc;
    if (original && image.src !== original) image.src = original;
    delete image.dataset.manualLeafletUrl;
    delete card.dataset.manualLeafletCover;
    image.style.removeProperty('object-fit');
    const forced = card.dataset.forcedLeafletCard === '1';
    const badge = card.querySelector('.leafletCurrentBadge');
    if (badge) badge.textContent = forced ? 'Ručně přidaný' : 'Aktuální leták';
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = forced ? 'Nabídky obchodu' : 'Titulní strana';
  }

  async function applyCard(card) {
    const slug = slugFromCard(card);
    if (!slug || !card.isConnected) return;
    const settings = storeSettings.get(slug) || null;
    const hidden = isHidden(slug, settings);

    card.hidden = hidden;
    card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    card.dataset.homeLeafletVisibility = hidden ? 'hidden' : 'visible';
    if (hidden) card.style.setProperty('display', 'none', 'important');
    else card.style.removeProperty('display');

    const image = card.querySelector('.leafletFrontPage');
    if (!image) return;
    rememberAutomaticImage(image);
    const url = await desiredImage(slug, settings);
    if (!card.isConnected) return;
    if (!url) {
      restoreAutomatic(card, image);
      return;
    }

    if (image.dataset.manualLeafletUrl !== url || image.src !== url) {
      const current = image.currentSrc || image.src || '';
      if (current && current !== image.dataset.manualLeafletUrl && current !== url) {
        image.dataset.automaticLeafletSrc = current;
      }
      image.dataset.manualLeafletUrl = url;
      image.src = `${url}${url.includes('?') ? '&' : '?'}v=${generation}`;
    }
    card.dataset.manualLeafletCover = '1';
    image.style.setProperty('object-fit', 'cover');
    image.alt = `Vlastní ukázková fotografie letáku ${card.querySelector('h3')?.textContent?.trim() || slug}`;
    const badge = card.querySelector('.leafletCurrentBadge');
    if (badge) badge.textContent = 'Vlastní obrázek';
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = 'Ukázková fotografie';
  }

  function logoMarkup(settings) {
    if (settings.logoUrl) {
      return `<img class="leafletCardLogo" src="${esc(settings.logoUrl)}" alt="Logo ${esc(settings.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'leafletCardLogoFallback',textContent:'%' }))">`;
    }
    return '<span class="leafletCardLogoFallback" aria-hidden="true">%</span>';
  }

  function forcedCoverSource(settings) {
    if (/^https:\/\//i.test(settings.cover || '')) return settings.cover;
    if (settings.logoUrl) return settings.logoUrl;
    return 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22750%22 viewBox=%220 0 600 750%22%3E%3Crect width=%22600%22 height=%22750%22 fill=%22%23f3f8f8%22/%3E%3Ctext x=%22300%22 y=%22390%22 text-anchor=%22middle%22 font-size=%22130%22 font-family=%22Arial%22 font-weight=%22700%22 fill=%22%23159e94%22%3E%25%3C/text%3E%3C/svg%3E';
  }

  function forcedCardMarkup(settings) {
    const source = forcedCoverSource(settings);
    return `<article class="leafletCard" data-direct-leaflet-card="1" data-forced-leaflet-card="1" data-store-slug="${esc(settings.slug)}">
      <a class="leafletCover leafletCoverLink" href="${esc(settings.slug)}.html" aria-label="Otevřít nabídky ${esc(settings.name)}">
        <img class="leafletFrontPage" src="${esc(source)}" data-automatic-leaflet-src="${esc(source)}" alt="Nabídky obchodu ${esc(settings.name)}" style="object-fit:${settings.cover ? 'cover' : 'contain'};background:#fff">
        <span class="leafletCurrentBadge">Ručně přidaný</span>
      </a>
      <div class="leafletBody">
        <div class="leafletStoreIdentity">${logoMarkup(settings)}<h3>${esc(settings.name)}</h3></div>
        <div class="leafletMeta"><span>Nabídky obchodu</span><span>ručně přidaná karta</span></div>
        <div class="leafletAction">
          <button class="textButton" type="button" data-store="${esc(settings.slug)}">Zobrazit akce</button>
          <a href="${esc(settings.slug)}.html">Otevřít obchod ↗</a>
        </div>
      </div>
    </article>`;
  }

  function ensureForcedCards(grid) {
    const cards = [...grid.querySelectorAll('.leafletCard')];
    const automaticSlugs = new Set(cards
      .filter((card) => card.dataset.forcedLeafletCard !== '1')
      .map(slugFromCard).filter(Boolean));

    cards.filter((card) => card.dataset.forcedLeafletCard === '1').forEach((card) => {
      const slug = slugFromCard(card);
      const settings = storeSettings.get(slug);
      if (!settings?.force || isHidden(slug, settings) || automaticSlugs.has(slug)) card.remove();
    });

    const existing = new Set([...grid.querySelectorAll('.leafletCard')].map(slugFromCard).filter(Boolean));
    for (const settings of storeSettings.values()) {
      if (!settings.force || isHidden(settings.slug, settings) || existing.has(settings.slug)) continue;
      grid.insertAdjacentHTML('beforeend', forcedCardMarkup(settings));
      existing.add(settings.slug);
    }
  }

  async function applyAll() {
    if (applying) return;
    applying = true;
    try {
      const grid = document.getElementById('leafletGrid');
      if (!grid) return;
      ensureForcedCards(grid);
      const cards = [...grid.querySelectorAll('.leafletCard')];
      await Promise.allSettled(cards.map(applyCard));
    } finally {
      applying = false;
    }
  }

  function schedule() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(applyAll, 90);
  }

  async function refresh(force = false) {
    await loadSettings(force);
    await applyAll();
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    new MutationObserver(schedule).observe(grid, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
    });
    refresh(true);
    window.setInterval(() => refresh(true), 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh(true);
    });
  }

  window.addEventListener('storage', (event) => {
    if (event.key === 'slevao-leaflet-visibility-changed' || event.key === 'slevao-homepage-image-changed') refresh(true);
  });
  window.addEventListener('slevao:leaflet-visibility-changed', () => refresh(true));
  window.addEventListener('slevao:homepage-image-changed', () => refresh(true));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();