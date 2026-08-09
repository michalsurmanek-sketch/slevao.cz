(() => {
  'use strict';

  const mobile = window.matchMedia('(max-width: 800px)');
  const VIEWPORT_GAP = 12;
  const FAST_CACHE_KEY = 'slevao-mobile-leaflet-fast-v1';
  const FAST_CACHE_TTL = 30 * 60 * 1000;
  let fastWriting = false;
  let fastMarkup = '';

  function readFastCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(FAST_CACHE_KEY) || 'null');
      if (!cached || Date.now() - Number(cached.savedAt || 0) > FAST_CACHE_TTL) return '';
      return String(cached.html || '');
    } catch {
      return '';
    }
  }

  function saveFastCache(html) {
    if (!html) return;
    fastMarkup = html;
    try {
      sessionStorage.setItem(FAST_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), html }));
    } catch {}
  }

  function rememberQuickLeafletCards(grid) {
    const cards = grid.querySelectorAll('.leafletCard:not([data-direct-leaflet-card="1"])');
    if (!cards.length) return false;
    saveFastCache(grid.innerHTML);
    return true;
  }

  function restoreQuickLeafletCards(grid) {
    const html = fastMarkup || readFastCache();
    if (!html) return false;
    fastWriting = true;
    grid.innerHTML = html;
    grid.querySelectorAll('.leafletCard').forEach((card) => {
      card.dataset.directLeafletCard = '1';
      card.dataset.instantLeafletFallback = '1';
    });
    fastWriting = false;
    return true;
  }

  function showFastSkeletons(grid) {
    if (!grid.querySelector('.loadingState')) return;
    fastWriting = true;
    grid.innerHTML = `
      <article class="leafletCard" data-direct-leaflet-card="1" data-instant-leaflet-fallback="1" aria-hidden="true">
        <div class="leafletCover"><div class="skeleton" style="width:100%;height:100%;min-height:330px;border-radius:inherit"></div></div>
        <div class="leafletBody"><div class="skeleton" style="height:28px;width:58%;border-radius:10px"></div><div class="skeleton" style="height:18px;width:82%;margin-top:14px;border-radius:9px"></div></div>
      </article>
      <article class="leafletCard" data-direct-leaflet-card="1" data-instant-leaflet-fallback="1" aria-hidden="true">
        <div class="leafletCover"><div class="skeleton" style="width:100%;height:100%;min-height:330px;border-radius:inherit"></div></div>
        <div class="leafletBody"><div class="skeleton" style="height:28px;width:58%;border-radius:10px"></div><div class="skeleton" style="height:18px;width:82%;margin-top:14px;border-radius:9px"></div></div>
      </article>`;
    fastWriting = false;
  }

  function accelerateLeaflets() {
    if (!mobile.matches) return;
    const grid = document.getElementById('leafletGrid');
    if (!grid || grid.dataset.fastLeafletObserver === '1') return;
    grid.dataset.fastLeafletObserver = '1';
    fastMarkup = readFastCache();

    const react = () => {
      if (fastWriting) return;
      if (rememberQuickLeafletCards(grid)) return;
      if (!grid.querySelector('.loadingState')) return;
      if (!restoreQuickLeafletCards(grid)) showFastSkeletons(grid);
    };

    new MutationObserver(react).observe(grid, { childList: true });
    react();
  }

  function scrollLeafletsToReferencePosition() {
    if (!mobile.matches) return;

    const section = document.getElementById('leafletsSection');
    if (!section) return;

    document.body.classList.add('showOriginalLeaflets');

    const target = section.querySelector('.sectionHead p')
      || section.querySelector('.sectionHead')
      || section;
    const topbar = document.querySelector('.topbar');
    const fixedTop = topbar ? topbar.getBoundingClientRect().bottom : 0;
    const targetTop = target.getBoundingClientRect().top;
    const scrollTop = window.scrollY + targetTop - fixedTop - VIEWPORT_GAP;

    const leafletGrid = document.getElementById('leafletGrid');
    if (leafletGrid) {
      leafletGrid.scrollTo({ left: 0, behavior: 'auto' });
    }

    window.scrollTo({
      top: Math.max(0, scrollTop),
      behavior: 'smooth'
    });

    if (window.location.hash !== '#leafletsSection') {
      history.replaceState(null, '', '#leafletsSection');
    }
  }

  function settlePosition() {
    accelerateLeaflets();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollLeafletsToReferencePosition();
        window.setTimeout(scrollLeafletsToReferencePosition, 180);
      });
    });
  }

  function attach() {
    accelerateLeaflets();
    const link = document.querySelector('.mobileNav a[href="#leafletsSection"]');
    if (!link || link.dataset.leafletPositionBound === '1') return;

    link.dataset.leafletPositionBound = '1';
    link.addEventListener('click', (event) => {
      if (!mobile.matches) return;
      event.preventDefault();
      event.stopPropagation();
      settlePosition();
    }, true);
  }

  attach();
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
})();
