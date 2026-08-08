(() => {
  'use strict';

  if (window.__slevaoOverviewLeafletsFixLoaded) return;
  window.__slevaoOverviewLeafletsFixLoaded = true;

  const MAX_RETRIES = 40;
  const RETRY_MS = 650;
  const RELOAD_AFTER = 8;
  let retries = 0;
  let retryTimer = 0;
  let observer = null;
  let writing = false;

  function cleanClone(card) {
    const clone = card.cloneNode(true);
    clone.removeAttribute('id');
    clone.hidden = false;
    clone.removeAttribute('aria-hidden');
    clone.style.removeProperty('display');
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.classList.add('overviewLeafletCard');
    return clone;
  }

  function visibleCards(source) {
    return [...source.querySelectorAll('.leafletCard')].filter((card) => (
      !card.hidden && card.dataset.homeLeafletVisibility !== 'hidden'
    ));
  }

  function updatePager(totalCards) {
    const count = document.getElementById('overview-leaflets-page');
    if (count && !document.querySelector('#overviewLeaflets .leafletCard')) {
      count.textContent = `1/${Math.max(1, Math.ceil(totalCards / 3))}`;
    }
  }

  function renderIfNeeded() {
    const source = document.getElementById('leafletGrid');
    const target = document.getElementById('overviewLeaflets');
    if (!source || !target || writing) return false;

    const cards = visibleCards(source);
    if (cards.length) {
      const hasCards = Boolean(target.querySelector('.leafletCard'));
      if (!hasCards) {
        writing = true;
        target.replaceChildren(...cards.slice(0, 3).map(cleanClone));
        updatePager(cards.length);
        writing = false;
      }
      window.clearTimeout(retryTimer);
      retryTimer = 0;
      return true;
    }

    if (source.dataset.directLeafletRenderer === 'error' && retries >= RELOAD_AFTER) {
      document.getElementById('reloadLeafletCovers')?.click();
    }

    if (retries < MAX_RETRIES) {
      retries += 1;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(renderIfNeeded, RETRY_MS);
    }
    return false;
  }

  function start() {
    const source = document.getElementById('leafletGrid');
    if (!source) {
      retryTimer = window.setTimeout(start, RETRY_MS);
      return;
    }

    observer = new MutationObserver(() => {
      retries = 0;
      window.requestAnimationFrame(renderIfNeeded);
    });
    observer.observe(source, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'hidden', 'style', 'class', 'data-home-leaflet-visibility', 'data-direct-leaflet-renderer']
    });

    renderIfNeeded();
    window.setTimeout(renderIfNeeded, 1200);
    window.setTimeout(renderIfNeeded, 3000);
  }

  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    window.clearTimeout(retryTimer);
  }, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
