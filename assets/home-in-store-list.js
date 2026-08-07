(() => {
  'use strict';

  const api = () => window.SlevaoLocation || null;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });

  function preciseBranch(branches, position) {
    if (!branches?.length || !position) return null;
    const nearest = branches[0];
    const meters = Number(nearest.distance_km || Infinity) * 1000;
    const accuracy = Math.max(0, Number(position.accuracy || 0));
    return accuracy > 0 && accuracy <= 45 && meters <= Math.max(55, accuracy * 1.35) ? nearest : null;
  }

  async function context() {
    const a = api();
    if (!a) return null;
    const position = await a.getPosition();
    const radius = Number(document.getElementById('slLiveRadius')?.value || 15);
    const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
    const branch = preciseBranch(branches, position);
    if (!branch) return null;
    const offers = await a.fetchOffersForStores([branch.store_id], branches);
    return { branch, offers };
  }

  function bestOffer(productId, offers) {
    return offers
      .filter((offer) => String(offer.product_id || '') === String(productId || ''))
      .filter((offer) => Number(offer.price || 0) > 0)
      .sort((x, y) => Number(x.price) - Number(y.price))[0] || null;
  }

  async function render() {
    const a = api();
    if (!a) return;
    try {
      const card = document.querySelector('#slInStore .slInStoreCard');
      if (!card) return;
      const rows = a.readList?.().filter((row) => !row.completed && row.product_id) || [];
      card.querySelector('.slInStoreListCoverage')?.remove();
      if (!rows.length) return;

      const current = await context();
      if (!current) return;
      const matched = [];
      const missing = [];
      let total = 0;

      for (const row of rows) {
        const offer = bestOffer(row.product_id, current.offers);
        if (!offer) { missing.push(row); continue; }
        const quantity = Math.max(.01, Number(row.quantity || 1));
        const subtotal = Number(offer.price || 0) * quantity;
        total += subtotal;
        matched.push({ row, offer, subtotal });
      }

      const box = document.createElement('section');
      box.className = 'slInStoreListCoverage';
      const detailRows = matched.slice(0, 5).map(({ row, offer, subtotal }) => `<div class="slInStoreListCoverageRow"><span><b>${esc(row.name || offer.title || 'Položka')}</b><small>${Number(row.quantity || 1).toLocaleString('cs-CZ')}× · propojená dnešní cena</small></span><strong>${money(subtotal)} Kč</strong></div>`).join('');
      box.innerHTML = `<div class="slInStoreListCoverageHead"><div><small>TVŮJ SEZNAM V TOMTO ŘETĚZCI</small><strong>${matched.length} z ${rows.length} položek má propojenou dnešní cenu</strong></div>${matched.length ? `<b>${money(total)} Kč</b>` : ''}</div>
        ${detailRows ? `<div class="slInStoreListCoverageRows">${detailRows}</div>` : ''}
        <p>${missing.length ? `U ${missing.length} ${missing.length === 1 ? 'položky' : missing.length < 5 ? 'položek' : 'položek'} nemáme v tomto řetězci propojenou dnešní cenu. To <strong>neznamená, že zboží není na prodejně</strong>.` : 'Pro všechny propojené položky ze seznamu máme v tomto řetězci dnešní cenu.'}</p>
        <a href="seznam.html?route=1">Porovnat celý seznam a dopočítat trasu →</a>`;

      const safe = card.querySelector('.slInStoreSafe');
      const grid = card.querySelector('.slInStoreGrid');
      if (safe) safe.before(box);
      else if (grid) grid.before(box);
      else card.appendChild(box);
    } catch {
      // Seznam v prodejně je doplněk; základní in-store režim zůstane funkční.
    }
  }

  function bind() {
    const button = document.getElementById('slLiveLocate');
    if (!button || button.dataset.inStoreListBound === '1') return false;
    button.dataset.inStoreListBound = '1';
    button.addEventListener('click', () => window.setTimeout(render, 650));
    return true;
  }

  function init() {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts++;
      if (api()?.__inStoreCacheReady && bind()) window.clearInterval(timer);
      else if (attempts >= 120) window.clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
