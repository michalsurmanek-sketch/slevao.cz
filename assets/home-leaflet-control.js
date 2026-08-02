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

  let storeSettings = new Map();
  let legacyHidden = new Set();
  let loading = null;
  let scheduled = 0;
  let generation = 0;
  const imageChecks = new Map();

  function parseParams(value) {
    const raw = String(value || '');
    const index = raw.indexOf('#');
    return index < 0 ? new URLSearchParams() : new URLSearchParams(raw.slice(index + 1));
  }

  function slugFromCard(card) {
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
      select: 'slug,website_url,logo_url,is_active',
      is_active: 'eq.true',
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
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
        .map((slug) => String(slug || '').trim().toLowerCase())
        .filter(Boolean));
    } catch (error) {
      console.warn('Staré nastavení viditelnosti není dostupné:', error);
      return new Set();
    }
  }

  function normalizeStore(row) {
    const website = parseParams(row?.website_url);
    const logo = parseParams(row?.logo_url);
    const visibility = website.get(VISIBILITY_KEY) || logo.get(VISIBILITY_KEY) || '';
    const cover = website.get(COVER_KEY) || logo.get(COVER_KEY) || '';
    return {
      visibility: visibility === 'hidden' || visibility === 'visible' ? visibility : '',
      cover,
    };
  }

  async function loadSettings(force = false) {
    if (loading && !force) return loading;
    loading = (async () => {
      const [rows, oldHidden] = await Promise.all([fetchStores(), fetchLegacyVisibility()]);
      const next = new Map();
      for (const row of rows || []) {
        const slug = String(row?.slug || '').trim().toLowerCase();
        if (slug) next.set(slug, normalizeStore(row));
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
    const cached = imageChecks.get(key);
    if (cached) return cached;
    const promise = new Promise((resolve) => {
      const image = new Image();
      const timer = window.setTimeout(() => resolve(''), 8000);
      image.onload = () => {
        window.clearTimeout(timer);
        resolve(url);
      };
      image.onerror = () => {
        window.clearTimeout(timer);
        resolve('');
      };
      image.src = `${url}${url.includes('?') ? '&' : '?'}slevao_card=${generation}-${Date.now()}`;
    });
    imageChecks.set(key, promise);
    return promise;
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
    const badge = card.querySelector('.leafletCurrentBadge');
    if (badge) badge.textContent = 'Aktuální leták';
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = 'Titulní strana';
  }

  async function desiredImage(slug, settings) {
    if (settings?.cover === 'none') return '';
    if (/^https:\/\//i.test(settings?.cover || '')) {
      return probeImage(settings.cover, `mapped:${slug}:${settings.cover}`);
    }
    return probeImage(legacyImageUrl(slug), `legacy:${slug}:${generation}`);
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

  function applyAll() {
    document.querySelectorAll('#leafletGrid .leafletCard').forEach((card) => {
      applyCard(card).catch((error) => console.warn('Kartu letáku se nepodařilo upravit:', error));
    });
  }

  function schedule() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(applyAll, 80);
  }

  async function refresh(force = false) {
    await loadSettings(force);
    applyAll();
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    new MutationObserver(schedule).observe(grid, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    refresh(true);
    window.setInterval(() => refresh(true), 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh(true);
    });
  }

  window.addEventListener('storage', (event) => {
    if (event.key === 'slevao-leaflet-visibility-changed' || event.key === 'slevao-homepage-image-changed') {
      refresh(true);
    }
  });
  window.addEventListener('slevao:leaflet-visibility-changed', () => refresh(true));
  window.addEventListener('slevao:homepage-image-changed', () => refresh(true));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
