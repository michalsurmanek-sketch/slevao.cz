(() => {
  'use strict';

  const CACHE_MS = 30000;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });

  function api() { return window.SlevaoLocation || null; }

  function memoizeAsync(target, name, keyFn) {
    const original = target?.[name];
    if (typeof original !== 'function' || original.__slevaoMemoized) return;
    const cache = new Map();
    const wrapped = async (...args) => {
      const key = keyFn(...args);
      const now = Date.now();
      const hit = cache.get(key);
      if (hit && now - hit.at < CACHE_MS) return hit.promise;
      const promise = Promise.resolve(original(...args)).catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, { at: now, promise });
      return promise;
    };
    wrapped.__slevaoMemoized = true;
    target[name] = wrapped;
  }

  function installSharedCache() {
    const a = api();
    if (!a || a.__inStoreCacheReady) return false;
    a.__inStoreCacheReady = true;
    memoizeAsync(a, 'getPosition', () => 'position');
    memoizeAsync(a, 'fetchNearbyBranches', (lat, lon, radius) => `branches:${Number(lat).toFixed(5)}:${Number(lon).toFixed(5)}:${Number(radius || 15)}`);
    memoizeAsync(a, 'fetchOffersForStores', (storeIds, branches) => {
      const ids = [...new Set((storeIds || []).map(String))].sort().join(',');
      const branchIds = (branches || []).map((row) => String(row.id || '')).sort().join(',');
      return `offers:${ids}:${branchIds}`;
    });
    return true;
  }

  function ensureUi() {
    const live = document.getElementById('slevaoLive');
    if (!live) return null;
    let node = document.getElementById('slInStore');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'slInStore';
    node.className = 'slInStore';
    node.hidden = true;
    const container = live.querySelector('.container') || live;
    const deals = document.getElementById('slLiveDeals');
    if (deals) deals.before(node); else container.appendChild(node);
    return node;
  }

  function preciseStore(branches, position) {
    if (!position || !branches?.length) return { state: 'none', branch: null };
    const nearest = branches[0];
    const meters = Number(nearest.distance_km || Infinity) * 1000;
    const accuracy = Math.max(0, Number(position.accuracy || 0));
    if (accuracy > 0 && accuracy <= 45 && meters <= Math.max(55, accuracy * 1.35)) {
      return { state: 'inside', branch: nearest, meters, accuracy };
    }
    if (meters <= 300) return { state: 'near', branch: nearest, meters, accuracy };
    return { state: 'far', branch: nearest, meters, accuracy };
  }

  function nearestBranchForStore(branches, storeId) {
    return (branches || [])
      .filter((branch) => String(branch.store_id) === String(storeId))
      .sort((a, b) => Number(a.distance_km ?? Infinity) - Number(b.distance_km ?? Infinity))[0] || null;
  }

  function competitorFor(offer, offers, branches) {
    if (!offer?.product_id) return null;
    const currentPrice = Number(offer.price || 0);
    if (!(currentPrice > 0)) return null;
    const cheaper = (offers || [])
      .filter((candidate) => String(candidate.product_id) === String(offer.product_id)
        && String(candidate.store_id) !== String(offer.store_id)
        && Number(candidate.price || 0) > 0
        && Number(candidate.price) <= currentPrice * .98)
      .sort((a, b) => Number(a.price) - Number(b.price))[0];
    if (!cheaper) return null;
    const branch = nearestBranchForStore(branches, cheaper.store_id);
    return {
      offer: cheaper,
      branch,
      saving: Number((currentPrice - Number(cheaper.price)).toFixed(2)),
    };
  }

  function offerCard(offer, comparison) {
    const a = api();
    const discount = a.documentedDiscount?.(offer) || 0;
    const href = offer.product_id ? `produkt.html?id=${encodeURIComponent(offer.product_id)}` : '#';
    const image = offer.image_url
      ? `<img loading="lazy" src="${esc(offer.image_url)}" alt="">`
      : '<span class="slInStoreFallback" aria-hidden="true">%</span>';
    const compare = comparison
      ? `<div class="slInStoreCompare"><strong>Jinde o ${money(comparison.saving)} Kč levněji</strong><span>${esc(comparison.offer.stores?.name || 'Jiný řetězec')}${comparison.branch && Number.isFinite(Number(comparison.branch.distance_km)) ? ` · ${Number(comparison.branch.distance_km).toLocaleString('cs-CZ',{maximumFractionDigits:1})} km` : ''} · ${money(comparison.offer.price)} Kč</span></div>`
      : '<div class="slInStoreCompare neutral"><span>U stejného propojeného produktu jsme v okolí nenašli levnější dnešní nabídku.</span></div>';
    return `<article class="slInStoreOffer">
      <a class="slInStoreOfferMain" href="${href}">${image}<span><small>${discount ? `Doložená sleva −${discount} %` : 'Dnešní nabídka'}</small><b>${esc(offer.title || 'Akční nabídka')}</b><strong>${money(offer.price)} Kč</strong></span></a>
      ${compare}
    </article>`;
  }

  function listComparison(currentBranch, offers, branches) {
    const a = api();
    const list = a.readList?.().filter((row) => !row.completed && row.product_id) || [];
    if (!list.length) return '';
    const currentStoreId = String(currentBranch.store_id || '');
    let currentMatched = 0;
    let cheaperElsewhere = 0;
    let possibleSaving = 0;
    for (const row of list) {
      const current = offers
        .filter((offer) => String(offer.product_id) === String(row.product_id) && String(offer.store_id) === currentStoreId)
        .sort((x, y) => Number(x.price) - Number(y.price))[0];
      if (!current) continue;
      currentMatched++;
      const alternative = competitorFor(current, offers, branches);
      if (alternative) {
        cheaperElsewhere++;
        possibleSaving += alternative.saving * Math.max(.01, Number(row.quantity || 1));
      }
    }
    if (!currentMatched) return '<p class="slInStoreListNote">Z vašeho nákupního seznamu teď nemáme cenu žádné položky v tomto řetězci.</p>';
    return `<p class="slInStoreListNote">Ze seznamu máme v tomto řetězci cenu pro <strong>${currentMatched}</strong> položek.${cheaperElsewhere ? ` U <strong>${cheaperElsewhere}</strong> z nich je dnes v okolí levnější alternativa; rozdíl je dohromady přibližně <strong>${money(possibleSaving)} Kč</strong>.` : ' U porovnatelných položek jsme v okolí nenašli levnější dnešní nabídku.'}</p>`;
  }

  function render(branches, offers, position) {
    const node = ensureUi();
    if (!node) return;
    const match = preciseStore(branches, position);
    if (!match.branch || match.state === 'far') {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }

    const branch = match.branch;
    const storeName = branch.stores?.name || branch.name || 'obchodu';
    const address = [branch.street, branch.city].filter(Boolean).join(', ');
    if (match.state !== 'inside') {
      node.hidden = false;
      node.innerHTML = `<div class="slInStoreNear"><span class="slInStoreNearIcon">◎</span><div><small>SLEVAO LIVE · POLOHA NENÍ DOST PŘESNÁ</small><strong>Zdá se, že jste poblíž ${esc(storeName)}</strong><p>${esc(address)} · přibližně ${Math.max(10, Math.round(match.meters / 10) * 10)} m. Režim „jsem v obchodě“ nezapínáme bez dostatečně přesné GPS.</p></div></div>`;
      return;
    }

    const a = api();
    const currentOffers = (offers || []).filter((offer) => String(offer.store_id) === String(branch.store_id));
    const top = a.rankOffers?.(currentOffers, 4) || currentOffers.slice(0, 4);
    const cards = top.length
      ? top.map((offer) => offerCard(offer, competitorFor(offer, offers, branches))).join('')
      : '<div class="slInStoreEmpty">Pobočku jsme rozpoznali, ale pro tento řetězec teď nemáme načtenou dnešní nabídku.</div>';
    const storeOfferCount = currentOffers.length;
    const accuracy = Math.round(match.accuracy);

    node.hidden = false;
    node.innerHTML = `<section class="slInStoreCard">
      <header class="slInStoreHead">
        <div><span class="slInStoreBadge"><i></i> PRAVDĚPODOBNĚ JSTE ZDE</span><h2>${esc(storeName)}</h2><p>${esc(address)} · GPS přibližně ±${accuracy} m</p></div>
        <div class="slInStoreCount"><strong>${storeOfferCount}</strong><span>dnešních akcí řetězce</span></div>
      </header>
      ${listComparison(branch, offers, branches)}
      <div class="slInStoreGrid">${cards}</div>
      <footer><span>Celostátní nabídky označujeme jako nabídky řetězce; netvrdíme skladovou dostupnost na konkrétní pobočce.</span><a href="seznam.html?route=1">Spočítat celý nákup a trasu →</a></footer>
    </section>`;
  }

  async function evaluateAfterLocate() {
    const a = api();
    if (!a) return;
    try {
      const radius = Number(document.getElementById('slLiveRadius')?.value || 15);
      const position = await a.getPosition();
      const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
      if (!branches.length) { render([], [], position); return; }
      const stores = a.uniqueStores(branches);
      const offers = await a.fetchOffersForStores(stores.map((branch) => branch.store_id), branches);
      render(branches, offers, position);
    } catch {
      const node = ensureUi();
      if (node) { node.hidden = true; node.innerHTML = ''; }
    }
  }

  function bind() {
    if (!installSharedCache()) return false;
    const button = document.getElementById('slLiveLocate');
    if (!button || button.dataset.inStoreBound === '1') return Boolean(button);
    button.dataset.inStoreBound = '1';
    button.addEventListener('click', () => { evaluateAfterLocate(); });
    return true;
  }

  function init() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (api() && document.getElementById('slevaoLive') && bind()) {
        clearInterval(timer);
        ensureUi();
      } else if (attempts >= 100) {
        clearInterval(timer);
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
