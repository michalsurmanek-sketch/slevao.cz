(() => {
  'use strict';

  const bound = new WeakSet();

  function api() { return window.SlevaoLocation || null; }
  function publicApi() { return window.SlevaoPublic || null; }

  function productIdFromCard(card) {
    const href = card.querySelector('.slInStoreOfferMain')?.getAttribute('href') || '';
    try {
      const url = new URL(href, location.href);
      return url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function preciseBranch(branches, position) {
    if (!branches?.length || !position) return null;
    const nearest = branches[0];
    const meters = Number(nearest.distance_km || Infinity) * 1000;
    const accuracy = Math.max(0, Number(position.accuracy || 0));
    return accuracy > 0 && accuracy <= 45 && meters <= Math.max(55, accuracy * 1.35) ? nearest : null;
  }

  async function resolveOffer(productId) {
    const a = api();
    if (!a || !productId) return null;
    const radius = Number(document.getElementById('slLiveRadius')?.value || 15);
    const position = await a.getPosition();
    const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
    const current = preciseBranch(branches, position);
    if (!current) throw new Error('Pobočku už nelze potvrdit dostatečně přesnou GPS.');
    const offers = await a.fetchOffersForStores([current.store_id], branches);
    return offers
      .filter((offer) => String(offer.product_id || '') === String(productId))
      .sort((x, y) => Number(x.price || 0) - Number(y.price || 0))[0] || null;
  }

  async function add(card, button) {
    const p = publicApi();
    if (!p?.addItemFromOffer) return;
    const productId = productIdFromCard(card);
    if (!productId) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Ověřuji…';
    try {
      const offer = await resolveOffer(productId);
      if (!offer) throw new Error('Dnešní nabídku se už nepodařilo ověřit.');
      p.addItemFromOffer(offer);
      button.textContent = '✓ V seznamu';
      button.classList.add('done');
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      const note = card.querySelector('.slInStoreActionNote') || document.createElement('small');
      note.className = 'slInStoreActionNote';
      note.textContent = error?.message || 'Položku se nepodařilo přidat.';
      card.appendChild(note);
    }
  }

  function enhance(card) {
    if (!card || bound.has(card)) return;
    bound.add(card);
    const productId = productIdFromCard(card);
    if (!productId) return;
    const row = document.createElement('div');
    row.className = 'slInStoreActions';
    row.innerHTML = '<button type="button">＋ Do seznamu</button><a href="seznam.html?route=1">Seznam + trasa →</a>';
    row.querySelector('button').addEventListener('click', (event) => add(card, event.currentTarget));
    card.appendChild(row);
  }

  function enhanceAll() {
    document.querySelectorAll('#slInStore .slInStoreOffer').forEach(enhance);
  }

  function init() {
    enhanceAll();
    const target = document.getElementById('slevaoLive') || document.body;
    const observer = new MutationObserver(enhanceAll);
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
