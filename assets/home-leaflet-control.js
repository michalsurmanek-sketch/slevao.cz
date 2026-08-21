(() => {
  'use strict';
  if (window.__slevaoLeafletControlLoaded) return;
  window.__slevaoLeafletControlLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const COVER_KEY = 'slevao-cover';
  const VISIBILITY_KEY = 'slevao-leaflet-visibility';
  const FORCE_KEY = 'slevao-leaflet-force';

  let storeSettings = new Map();
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
    if (loading) return loading;
    loading = (async () => {
      const rows = await fetchStores();
      const next = new Map();
      for (const row of rows || []) {
        const setting = normalizeStore(row);
        if (setting.slug) next.set(setting.slug, setting);
      }
      storeSettings = next;
      generation += 1;
      imageChecks.clear();
    })().catch((error) => {
      console.warn('Nastavení karet letáků se nepodařilo načíst:', error);
    }).finally(() => {
      loading = null;
    });
    return loading;
  }

  function isHidden(settings) {
    return settings?.visibility === 'hidden';
  }

  function probeImage(url, key) {
    if (!url || url === 'none') return Promise.resolve('');
    if (imageChecks.has(key)) return imageChecks.get(key);
    const promise = new Promise((resolve) => {
      const image = new Image();
      const timer = window.setTimeout(() => resolve(''), 7000);
      image.onload = () => { window.clearTimeout(timer); resolve(url); };
      image.onerror = () => { window.clearTimeout(timer); resolve(''); };
      image.src = url;
    });
    imageChecks.set(key, promise);
    return promise;
  }

  async function desiredImage(slug, settings) {
    if (settings?.cover === 'none') return '';
    if (/^https:\/\//i.test(settings?.cover || '')) {
      return probeImage(settings.cover, `mapped:${slug}:${settings.cover}`);
    }
    // Current admin stores a custom cover URL directly in store metadata. The old
    // homepage-leaflet-images bucket is intentionally not probed when no marker is
    // present, avoiding a 400 request for every card on every refresh.
    return '';
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
    if (badge) badge.textContent = forced ? 'Aktuální nabídky' : 'Aktuální leták';
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = forced ? 'Nabídky obchodu' : 'Titulní strana';
  }

  async function applyCard(card) {
    const slug = slugFromCard(card);
    if (!slug || !card.isConnected) return;
    const settings = storeSettings.get(slug) || null;
    const hidden = isHidden(settings);

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
      image.src = url;
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
    const obi = settings.slug === 'obi';
    const background = obi ? '#f56600' : '#087e75';
    const accent = obi ? '#ffffff' : '#67ddd3';
    const name = esc(settings.name || settings.slug || 'Obchod');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750">
      <rect width="600" height="750" rx="34" fill="${background}"/>
      <circle cx="510" cy="90" r="150" fill="${accent}" opacity=".14"/>
      <circle cx="85" cy="690" r="190" fill="${accent}" opacity=".1"/>
      <rect x="48" y="48" width="504" height="654" rx="28" fill="none" stroke="#fff" stroke-width="4" opacity=".5"/>
      <text x="300" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="${name.length > 12 ? 62 : 92}" font-weight="900" fill="#fff">${name}</text>
      <rect x="135" y="365" width="330" height="4" rx="2" fill="#fff" opacity=".7"/>
      <text x="300" y="430" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#fff">AKTUÁLNÍ NABÍDKY</text>
      <text x="300" y="490" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#fff" opacity=".85">Prohlédněte si nabídku obchodu</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function forcedCardMarkup(settings) {
    const source = forcedCoverSource(settings);
    return `<article class="leafletCard" data-direct-leaflet-card="1" data-forced-leaflet-card="1" data-store-slug="${esc(settings.slug)}">
      <a class="leafletCover leafletCoverLink" href="${esc(settings.slug)}.html" aria-label="Otevřít nabídky ${esc(settings.name)}">
        <img class="leafletFrontPage" src="${esc(source)}" data-automatic-leaflet-src="${esc(source)}" alt="Nabídky obchodu ${esc(settings.name)}" style="object-fit:cover;background:#fff">
        <span class="leafletCurrentBadge">Aktuální nabídky</span>
      </a>
      <div class="leafletBody">
        <div class="leafletStoreIdentity">${logoMarkup(settings)}<h3>${esc(settings.name)}</h3></div>
        <div class="leafletMeta"><span>Nabídky obchodu</span><span>Aktuálně online</span></div>
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
      if (!settings?.force || isHidden(settings) || automaticSlugs.has(slug)) card.remove();
    });

    const existing = new Set([...grid.querySelectorAll('.leafletCard')].map(slugFromCard).filter(Boolean));
    for (const settings of storeSettings.values()) {
      if (!settings.force || isHidden(settings) || existing.has(settings.slug)) continue;
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
    window.setInterval(() => {
      if (document.hidden) return;
      refresh(true);
    }, 5 * 60 * 1000);
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