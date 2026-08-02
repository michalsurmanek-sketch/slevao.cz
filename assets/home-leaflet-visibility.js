(() => {
  'use strict';
  if (window.__slevaoLeafletVisibilityLoaded) return;
  window.__slevaoLeafletVisibilityLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const SETTINGS_URL = `${SUPABASE_URL}/storage/v1/object/public/homepage-leaflet-settings/visibility.json`;
  const META_KEY = 'slevao-leaflet-visibility';
  let hidden = new Set();
  let loading = null;
  let scheduled = 0;

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
    const marker = new URLSearchParams(raw.slice(index + 1)).get(META_KEY);
    return marker === 'hidden' || marker === 'visible' ? marker : '';
  }

  async function legacySettings() {
    try {
      const response = await fetch(`${SETTINGS_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (response.status === 404) return new Set();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return new Set((Array.isArray(payload?.hidden_slugs) ? payload.hidden_slugs : [])
        .map((slug) => String(slug || '').trim().toLowerCase())
        .filter(Boolean));
    } catch (error) {
      console.warn('Staré nastavení viditelnosti letáků není dostupné:', error);
      return new Set();
    }
  }

  async function storeOverrides() {
    try {
      const query = new URLSearchParams({
        select: 'slug,website_url,logo_url',
        is_active: 'eq.true',
      });
      const response = await fetch(`${SUPABASE_URL}/rest/v1/stores?${query}`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn('Přímé nastavení viditelnosti obchodů není dostupné:', error);
      return [];
    }
  }

  async function loadSettings(force = false) {
    if (loading && !force) return loading;
    loading = (async () => {
      const [legacy, stores] = await Promise.all([legacySettings(), storeOverrides()]);
      const next = new Set(legacy);
      for (const store of stores || []) {
        const slug = String(store?.slug || '').trim().toLowerCase();
        if (!slug) continue;
        const marker = markerIn(store.website_url) || markerIn(store.logo_url);
        if (marker === 'hidden') next.add(slug);
        if (marker === 'visible') next.delete(slug);
      }
      return next;
    })();
    hidden = await loading;
    loading = null;
    return hidden;
  }

  function applyCard(card) {
    const slug = slugFromCard(card);
    if (!slug) return;
    const isHidden = hidden.has(slug);
    card.hidden = isHidden;
    card.dataset.homeLeafletVisibility = isHidden ? 'hidden' : 'visible';
    card.setAttribute('aria-hidden', isHidden ? 'true' : 'false');
  }

  function applyAll() {
    document.querySelectorAll('#leafletGrid .leafletCard').forEach(applyCard);
  }

  function schedule() {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(applyAll, 40);
  }

  async function refresh(force = false) {
    await loadSettings(force);
    applyAll();
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;
    new MutationObserver(schedule).observe(grid, { childList: true, subtree: true });
    refresh(false);
    window.setInterval(() => refresh(true), 60000);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === 'slevao-leaflet-visibility-changed') refresh(true);
  });
  window.addEventListener('slevao:leaflet-visibility-changed', () => refresh(true));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
