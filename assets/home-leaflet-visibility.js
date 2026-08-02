(() => {
  'use strict';
  if (window.__slevaoLeafletVisibilityLoaded) return;
  window.__slevaoLeafletVisibilityLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SETTINGS_URL = `${SUPABASE_URL}/storage/v1/object/public/homepage-leaflet-settings/visibility.json`;
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

  async function loadSettings(force = false) {
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        const response = await fetch(`${SETTINGS_URL}?v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
        if (response.status === 404) return new Set();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        return new Set((Array.isArray(payload?.hidden_slugs) ? payload.hidden_slugs : [])
          .map((slug) => String(slug || '').trim().toLowerCase())
          .filter(Boolean));
      } catch (error) {
        console.warn('Nastavení viditelnosti letáků se nepodařilo načíst:', error);
        return hidden;
      }
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

  window.addEventListener('slevao:leaflet-visibility-changed', () => refresh(true));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
