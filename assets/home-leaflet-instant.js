(() => {
  'use strict';

  const CACHE_KEY = 'slevao-leaflet-instant-v1';
  const CACHE_TTL = 30 * 60 * 1000;
  let writing = false;
  let lastFastMarkup = '';

  function readCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL) return '';
      return String(cached.html || '');
    } catch {
      return '';
    }
  }

  function saveCache(html) {
    if (!html) return;
    lastFastMarkup = html;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), html }));
    } catch {}
  }

  function isUsableFastGrid(grid) {
    return Boolean(grid.querySelector('.leafletCard:not([data-direct-leaflet-card="1"])'));
  }

  function rememberFastGrid(grid) {
    if (!isUsableFastGrid(grid)) return;
    saveCache(grid.innerHTML);
  }

  function restoreFastGrid(grid) {
    const html = lastFastMarkup || readCache();
    if (!html) return false;
    writing = true;
    grid.innerHTML = html;
    grid.querySelectorAll('.leafletCard').forEach((card) => {
      card.dataset.directLeafletCard = '1';
      card.dataset.instantLeafletFallback = '1';
    });
    grid.dataset.instantLeafletFallback = '1';
    writing = false;
    return true;
  }

  function replaceSpinnerWithSkeletons(grid) {
    if (!grid.querySelector('.loadingState')) return;
    writing = true;
    grid.innerHTML = `
      <article class="leafletCard leafletInstantSkeleton" data-direct-leaflet-card="1" aria-hidden="true">
        <div class="leafletCover"><div class="skeleton" style="width:100%;height:100%;min-height:320px;border-radius:inherit"></div></div>
        <div class="leafletBody"><div class="skeleton" style="height:28px;width:55%;border-radius:10px"></div><div class="skeleton" style="height:18px;width:80%;margin-top:14px;border-radius:9px"></div></div>
      </article>
      <article class="leafletCard leafletInstantSkeleton" data-direct-leaflet-card="1" aria-hidden="true">
        <div class="leafletCover"><div class="skeleton" style="width:100%;height:100%;min-height:320px;border-radius:inherit"></div></div>
        <div class="leafletBody"><div class="skeleton" style="height:28px;width:55%;border-radius:10px"></div><div class="skeleton" style="height:18px;width:80%;margin-top:14px;border-radius:9px"></div></div>
      </article>`;
    grid.dataset.instantLeafletFallback = '1';
    writing = false;
  }

  function start() {
    const grid = document.getElementById('leafletGrid');
    if (!grid) return;

    lastFastMarkup = readCache();
    if (lastFastMarkup && !grid.querySelector('.leafletCard')) restoreFastGrid(grid);

    const observer = new MutationObserver(() => {
      if (writing) return;

      if (isUsableFastGrid(grid)) {
        rememberFastGrid(grid);
        return;
      }

      if (grid.querySelector('.loadingState')) {
        if (!restoreFastGrid(grid)) replaceSpinnerWithSkeletons(grid);
      }

      if (grid.dataset.directLeafletRenderer === 'ready') {
        delete grid.dataset.instantLeafletFallback;
      }
    });

    observer.observe(grid, { childList: true, subtree: false });

    if (grid.querySelector('.loadingState')) {
      if (!restoreFastGrid(grid)) replaceSpinnerWithSkeletons(grid);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
