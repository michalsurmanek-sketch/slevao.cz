(() => {
  'use strict';

  if (window.__slevaoOverviewProductLinksLoaded) return;
  window.__slevaoOverviewProductLinksLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const TODAY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
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

  function prefetchProductLinks() {
    loadProductLinks();
  }

  async function followProductLink(event) {
    const row = event.target.closest('.overviewDealRow');
    if (!row || row.dataset.productDetailLink === '1') return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const fallbackHref = row.getAttribute('href') || '';
    event.preventDefault();
    await loadProductLinks();
    rewriteEndingLinks();

    const target = row.dataset.productDetailLink === '1' ? row.getAttribute('href') : fallbackHref;
    if (target) window.location.assign(target);
  }

  function watchEndingSection() {
    const target = document.getElementById('overviewEnding');
    if (!target) {
      retryTimer = window.setTimeout(watchEndingSection, 500);
      return;
    }

    endingObserver = new MutationObserver(() => {
      if (loaded) window.requestAnimationFrame(rewriteEndingLinks);
    });
    endingObserver.observe(target, { childList: true, subtree: true });

    target.addEventListener('pointerenter', prefetchProductLinks, { once: true, passive: true });
    target.addEventListener('pointerdown', prefetchProductLinks, { once: true, passive: true });
    target.addEventListener('focusin', prefetchProductLinks, { once: true });
    target.addEventListener('click', followProductLink);
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