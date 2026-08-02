(() => {
  'use strict';

  if (!document.querySelector('script[data-home-leaflet-visibility]')) {
    const visibility = document.createElement('script');
    visibility.src = `assets/home-leaflet-visibility.js?v=20260802-1-${Date.now()}`;
    visibility.async = false;
    visibility.dataset.homeLeafletVisibility = 'true';
    document.head.append(visibility);
  }

  if (window.__slevaoManualLeafletImagesLoaded) return;
  window.__slevaoManualLeafletImagesLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const LEGACY_BUCKET = 'homepage-leaflet-images';
  const COVER_META_KEY = 'slevao-cover';
  const checks = new Map();
  const mappedCovers = new Map();
  const explicitlyDisabled = new Set();
  let scheduled = 0;
  let loadingMappings = null;

  function slugFromCard(card) {
    const href = card.querySelector('.leafletCoverLink[href],.leafletAction a[href]')?.getAttribute('href') || '';
    try {
      const path = new URL(href, document.baseURI).pathname;
      return decodeURIComponent(path.split('/').pop() || '').replace(/\.html$/i, '').trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function markerIn(value) {
    const raw = String(value || '');
    const index = raw.indexOf('#');
    if (index < 0) return '';
    return new URLSearchParams(raw.slice(index + 1)).get(COVER_META_KEY) || '';
  }

  async function loadMappings(force = false) {
    if (loadingMappings && !force) return loadingMappings;
    loadingMappings = (async () => {
      const query = new URLSearchParams({
        select: 'slug,website_url,logo_url',
        is_active: 'eq.true',
      });
      const response = await fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      mappedCovers.clear();
      explicitlyDisabled.clear();
      for (const store of rows || []) {
        const slug = String(store?.slug || '').trim().toLowerCase();
        if (!slug) continue;
        const marker = markerIn(store.website_url) || markerIn(store.logo_url);
        if (marker === 'none') explicitlyDisabled.add(slug);
        else if (/^https:\/\//i.test(marker)) mappedCovers.set(slug, marker);
      }
    })().catch((error) => {
      console.warn('Vlastní obrázky obchodů se nepodařilo načíst:', error);
    }).finally(() => {
      loadingMappings = null;
    });
    return loadingMappings;
  }

  function legacyUrl(slug) {
    const version = Math.floor(Date.now() / 300000);
    return `${SUPABASE_URL}/storage/v1/object/public/${LEGACY_BUCKET}/${encodeURIComponent(slug)}/cover?v=${version}`;
  }

  function probe(url, cacheKey) {
    const cached = checks.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 60000) return cached.promise;
    const promise = new Promise((resolve) => {
      const image = new Image();
      const timer = window.setTimeout(() => resolve(''), 9000);
      image.onload = () => { window.clearTimeout(timer); resolve(url); };
      image.onerror = () => { window.clearTimeout(timer); resolve(''); };
      image.src = `${url}${url.includes('?') ? '&' : '?'}slevao_probe=${Date.now()}`;
    });
    checks.set(cacheKey, { savedAt: Date.now(), promise });
    return promise;
  }

  async function imageFor(slug) {
    if (explicitlyDisabled.has(slug)) return '';
    const mapped = mappedCovers.get(slug);
    if (mapped) {
      const valid = await probe(mapped, `mapped:${slug}:${mapped}`);
      if (valid) return valid;
    }
    return probe(legacyUrl(slug), `legacy:${slug}`);
  }

  function restoreCard(card, image) {
    if (!image.dataset.manualLeafletUrl) return;
    const original = image.dataset.automaticLeafletSrc;
    if (original) image.src = original;
    delete image.dataset.manualLeafletUrl;
    delete card.dataset.manualLeafletCover;
    image.style.objectFit = '';
    card.querySelector('.leafletCurrentBadge')?.replaceChildren(document.createTextNode('Aktuální leták'));
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = 'Titulní strana';
  }

  async function applyCard(card) {
    const slug = slugFromCard(card);
    const image = card.querySelector('.leafletFrontPage');
    if (!slug || !image) return;
    if (!image.dataset.automaticLeafletSrc && !image.dataset.manualLeafletUrl) {
      image.dataset.automaticLeafletSrc = image.src;
    }
    const url = await imageFor(slug);
    if (!card.isConnected) return;
    if (!url) {
      restoreCard(card, image);
      return;
    }
    if (image.dataset.manualLeafletUrl === url) return;

    card.dataset.manualLeafletCover = '1';
    image.dataset.manualLeafletUrl = url;
    image.src = url;
    image.alt = `Vlastní ukázková fotografie letáku ${card.querySelector('h3')?.textContent?.trim() || slug}`;
    image.style.objectFit = 'cover';
    card.querySelector('.leafletCurrentBadge')?.replaceChildren(document.createTextNode('Vlastní obrázek'));
    const meta = card.querySelector('.leafletMeta span:first-child');
    if (meta) meta.textContent = 'Ukázková fotografie';
  }

  function applyAll() {
    document.querySelectorAll('#leafletGrid .leafletCard').forEach((card) => applyCard(card));
  }

  function schedule() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(applyAll, 80);
  }

  async function refresh(force = false) {
    await loadMappings(force);
    if (force) checks.clear();
    applyAll();
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    new MutationObserver(schedule).observe(grid, {
      childList: true,
      subtree: true,
    });
    refresh(false);
    window.setInterval(() => refresh(true), 60000);
  }

  window.addEventListener('slevao:homepage-image-changed', () => refresh(true));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
