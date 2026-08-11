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

(() => {
  'use strict';

  if (window.__slevaoOverviewProductLinksLoaded) return;
  window.__slevaoOverviewProductLinksLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const TODAY = new Date().toISOString().slice(0, 10);
  const productLinks = new Map();
  let loaded = false;
  let loading = null;
  let endingObserver = null;
  let retryTimer = 0;

  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const key = (slug, title) => `${fold(slug)}|${fold(title)}`;

  function storeSlugFromRow(row) {
    if (row.dataset.overviewStoreSlug) return row.dataset.overviewStoreSlug;
    const href = String(row.getAttribute('href') || '');
    const match = href.match(/(?:^|\/)([^/?#]+)\.html(?:[?#]|$)/i);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function rewriteEndingLinks() {
    document.querySelectorAll('#overviewEnding .overviewDealRow').forEach((row) => {
      const title = row.querySelector('.overviewDealCopy strong')?.textContent || '';
      const slug = storeSlugFromRow(row);
      if (!title || !slug) return;

      row.dataset.overviewStoreSlug = slug;
      const productId = productLinks.get(key(slug, title));
      if (!productId) return;

      row.href = `produkt.html?id=${encodeURIComponent(productId)}`;
      row.dataset.productDetailLink = '1';
      row.setAttribute('aria-label', `Zobrazit detail produktu ${title.trim()}`);
    });
  }

  async function loadProductLinks() {
    if (loaded) return;
    if (loading) return loading;

    loading = (async () => {
      const query = new URLSearchParams({
        select: 'product_id,title,valid_to,published_at,stores(slug),products(name)',
        status: 'eq.published',
        valid_from: `lte.${TODAY}`,
        valid_to: `gte.${TODAY}`,
        order: 'valid_to.asc,published_at.desc',
        limit: '40'
      });

      const response = await fetch(`${SUPABASE_URL}/rest/v1/offers?${query}`, {
        headers: { apikey: SUPABASE_KEY },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const rows = await response.json();
      rows.forEach((offer) => {
        const productId = String(offer?.product_id || '').trim();
        const slug = String(offer?.stores?.slug || '').trim();
        if (!productId || !slug) return;

        [offer?.title, offer?.products?.name].filter(Boolean).forEach((title) => {
          const mapKey = key(slug, title);
          if (!productLinks.has(mapKey)) productLinks.set(mapKey, productId);
        });
      });

      loaded = true;
      rewriteEndingLinks();
    })().catch((error) => {
      console.warn('Odkazy na detail produktu se nepodařilo připravit:', error);
    }).finally(() => {
      loading = null;
    });

    return loading;
  }

  function watchEndingSection() {
    const target = document.getElementById('overviewEnding');
    if (!target) {
      retryTimer = window.setTimeout(watchEndingSection, 500);
      return;
    }

    endingObserver = new MutationObserver(() => {
      window.requestAnimationFrame(rewriteEndingLinks);
    });
    endingObserver.observe(target, { childList: true, subtree: true });

    loadProductLinks();
  }

  window.addEventListener('pagehide', () => {
    endingObserver?.disconnect();
    window.clearTimeout(retryTimer);
  }, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchEndingSection, { once: true });
  } else {
    watchEndingSection();
  }
})();
