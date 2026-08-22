(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const offerToProduct = new Map();
  let refreshQueued = false;
  let requestVersion = 0;

  function offerIdFromCard(card) {
    return String(card?.querySelector('.compareButton[data-compare-id]')?.dataset.compareId || '').trim();
  }

  function addFavoriteButton(card, productId) {
    productId = String(productId || '').trim();
    if (!card || !productId) return;
    const actions = card.querySelector('.dealActions');
    if (!actions || actions.querySelector(`[data-favorite-product="${CSS.escape(productId)}"]`)) return;
    card.dataset.productId = productId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'compareButton sfFavoriteButton';
    button.dataset.favoriteProduct = productId;
    button.setAttribute('aria-pressed', 'false');
    button.title = 'Uložit produkt do oblíbených';
    button.textContent = '♡ Oblíbit';
    actions.appendChild(button);
  }

  async function fetchProductIds(offerIds) {
    if (!offerIds.length) return;
    const params = new URLSearchParams({
      select: 'id,product_id',
      id: `in.(${offerIds.join(',')})`,
      status: 'eq.published',
      limit: String(Math.min(offerIds.length, 200)),
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/offers?${params}`, {
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Mapování oblíbených produktů selhalo (${response.status}).`);
    const rows = await response.json();
    const found = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const offerId = String(row?.id || '');
      if (!offerId) continue;
      found.add(offerId);
      offerToProduct.set(offerId, String(row?.product_id || ''));
    }
    for (const offerId of offerIds) {
      if (!found.has(offerId)) offerToProduct.set(offerId, '');
    }
  }

  async function refreshCards() {
    refreshQueued = false;
    const grid = document.getElementById('dealGrid');
    if (!grid) return;
    const cards = [...grid.querySelectorAll('.dealCard')];
    const missing = [];
    for (const card of cards) {
      const offerId = offerIdFromCard(card);
      if (!offerId) continue;
      if (offerToProduct.has(offerId)) {
        addFavoriteButton(card, offerToProduct.get(offerId));
      } else {
        missing.push(offerId);
      }
    }
    const uniqueMissing = [...new Set(missing)].slice(0, 200);
    if (!uniqueMissing.length) return;
    const version = ++requestVersion;
    try {
      await fetchProductIds(uniqueMissing);
      if (version !== requestVersion) return;
      for (const card of cards) {
        const offerId = offerIdFromCard(card);
        if (offerToProduct.has(offerId)) addFavoriteButton(card, offerToProduct.get(offerId));
      }
    } catch (error) {
      console.warn('slevao_home_product_favorites_failed', error);
    }
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => refreshCards());
  }

  const grid = document.getElementById('dealGrid');
  if (!grid) return;
  const observer = new MutationObserver(queueRefresh);
  observer.observe(grid, { childList: true, subtree: true });
  queueRefresh();
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  window.SlevaoHomeProductFavorites = { refresh: queueRefresh };
})();
