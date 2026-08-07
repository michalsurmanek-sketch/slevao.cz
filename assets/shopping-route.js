(() => {
  'use strict';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const sharedParams = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedParams.get('share') || sharedHash.get('share'));

  function api() { return window.SlevaoLocation || null; }

  function injectUi() {
    if (document.getElementById('shoppingRoute')) return true;
    const layout = document.querySelector('.sfListLayout');
    if (!layout) return false;
    const section = document.createElement('section');
    section.id = 'shoppingRoute';
    section.className = 'srRoute';
    section.innerHTML = `
      <div class="srRouteHead">
        <div><span class="srRouteBadge">GPS optimizer</span><h2>Nejlevnější trasa nákupu</h2><p>Nejde jen po nejlevnějších produktech. Započítá maximální počet obchodů, vzdálenost k reálným pobočkám a váhu každé další zastávky.</p></div>
      </div>
      <div class="srRouteControls">
        <label>Max. obchodů<select id="srMaxStores"><option value="1">1 obchod</option><option value="2" selected>2 obchody</option><option value="3">3 obchody</option></select></label>
        <label>Okruh<select id="srRadius"><option value="5">5 km</option><option value="10">10 km</option><option value="15" selected>15 km</option><option value="25">25 km</option><option value="40">40 km</option></select></label>
        <label>Váha cesty<input id="srKmCost" type="number" min="0" max="100" step="1" value="5"><span>Kč/km</span></label>
        <label>Další zastávka<input id="srStopCost" type="number" min="0" max="500" step="5" value="30"><span>Kč</span></label>
        <button id="srCalculate" class="srRouteButton" type="button">Spočítat trasu</button>
      </div>
      <div id="srStatus" class="srRouteStatus">Výpočet se spustí až po kliknutí a vyžádá si polohu. Vzdálenost je konzervativní orientační výpočet vzdušnou čarou, ne navigační čas.</div>
      <div id="srResults"></div>`;
    layout.parentNode.insertBefore(section, layout);
    const button = document.getElementById('srCalculate');
    if (sharedMode) {
      button.disabled = true;
      document.getElementById('srStatus').textContent = 'GPS trasa je zatím dostupná jen pro vlastní nákupní seznam. U sdíleného seznamu se záměrně nepoužívá localStorage, aby nevznikl výpočet z cizích nebo starých položek.';
    } else {
      button.addEventListener('click', calculate);
    }
    return true;
  }

  function status(text, type = '') {
    const node = document.getElementById('srStatus');
    if (!node) return;
    node.textContent = text;
    node.className = `srRouteStatus${type ? ` ${type}` : ''}`;
  }

  function combinations(items, maxSize) {
    const output = [];
    function walk(start, chosen, target) {
      if (chosen.length === target) { output.push([...chosen]); return; }
      for (let i = start; i <= items.length - (target - chosen.length); i++) {
        chosen.push(items[i]);
        walk(i + 1, chosen, target);
        chosen.pop();
      }
    }
    for (let size = 1; size <= Math.min(maxSize, items.length); size++) walk(0, [], size);
    return output;
  }

  function permutations(items) {
    if (items.length <= 1) return [items.slice()];
    const result = [];
    items.forEach((item, index) => {
      const rest = [...items.slice(0, index), ...items.slice(index + 1)];
      for (const tail of permutations(rest)) result.push([item, ...tail]);
    });
    return result;
  }

  function routeForStores(storeIds, branchByStore, position) {
    const branches = storeIds.map((id) => branchByStore.get(String(id))).filter(Boolean);
    if (branches.length !== storeIds.length) return null;
    let best = null;
    for (const order of permutations(branches)) {
      let distance = 0;
      let lat = position.latitude, lon = position.longitude;
      for (const branch of order) {
        distance += api().distanceKm(lat, lon, branch.latitude, branch.longitude);
        lat = Number(branch.latitude); lon = Number(branch.longitude);
      }
      if (!best || distance < best.distanceKm) {
        best = {
          distanceKm: distance,
          order,
          start: { latitude: Number(position.latitude), longitude: Number(position.longitude) },
        };
      }
    }
    return best;
  }

  function navigationUrl(route) {
    if (!route?.order?.length || !Number.isFinite(route.start?.latitude) || !Number.isFinite(route.start?.longitude)) return '';
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', `${route.start.latitude},${route.start.longitude}`);
    const destination = route.order[route.order.length - 1];
    url.searchParams.set('destination', `${destination.latitude},${destination.longitude}`);
    if (route.order.length > 1) {
      url.searchParams.set('waypoints', route.order.slice(0, -1).map((branch) => `${branch.latitude},${branch.longitude}`).join('|'));
    }
    url.searchParams.set('travelmode', 'driving');
    return url.toString();
  }

  function planFor(combo, rows, offers, branchByStore, position, kmCost, stopCost) {
    const allowed = new Set(combo.map(String));
    const chosen = [];
    let basketTotal = 0;
    for (const row of rows) {
      const offer = offers
        .filter((candidate) => String(candidate.product_id) === String(row.product_id) && allowed.has(String(candidate.store_id)))
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
      if (!offer) return null;
      const subtotal = Number(offer.price || 0) * Math.max(.01, Number(row.quantity || 1));
      basketTotal += subtotal;
      chosen.push({ row, offer, subtotal });
    }
    const usedStores = [...new Set(chosen.map((item) => String(item.offer.store_id)))];
    const route = routeForStores(usedStores, branchByStore, position);
    if (!route) return null;
    const transportWeight = route.distanceKm * kmCost;
    const stopWeight = Math.max(0, usedStores.length - 1) * stopCost;
    return {
      basketTotal,
      chosen,
      usedStores,
      route,
      transportWeight,
      stopWeight,
      effectiveCost: basketTotal + transportWeight + stopWeight,
    };
  }

  function render(best, single, absolute, rows) {
    const a = api();
    const results = document.getElementById('srResults');
    if (!best) {
      results.innerHTML = '';
      status('Pro zvolený okruh a počet obchodů chybí úplná kombinace cen pro všechny propojené položky.', 'bad');
      return;
    }
    const stops = best.route.order.map((branch, index) => {
      const name = branch.stores?.name || branch.name || 'Obchod';
      const place = [branch.street, branch.city].filter(Boolean).join(', ');
      return `${index ? '<span class="srRouteArrow">→</span>' : ''}<span class="srRouteStop"><b>${esc(name)}</b>${place ? `<small>${esc(place)}</small>` : ''}</span>`;
    }).join('');
    const mapUrl = navigationUrl(best.route);
    const singleDiff = single ? single.effectiveCost - best.effectiveCost : null;
    const absoluteDiff = absolute ? best.effectiveCost - absolute.basketTotal : null;
    results.innerHTML = `
      <div class="srRouteResults">
        <article class="srRouteBest">
          <h3>Doporučená kombinace</h3>
          <div class="srRoutePrice">${a.money(best.basketTotal)} Kč</div>
          <div class="srRouteEffective">Cena samotného nákupu. Rozhodovací náklad po započtení cesty a zastávek: <strong>${a.money(best.effectiveCost)} Kč</strong>.</div>
          <div class="srRouteStops">${stops}</div>
          ${mapUrl ? `<a class="srRouteMapLink" href="${esc(mapUrl)}" target="_blank" rel="noopener">Otevřít skutečnou trasu v Google Maps →</a>` : ''}
          <div class="srRouteFacts">
            <div class="srRouteFact"><small>Obchody</small><strong>${best.usedStores.length}</strong></div>
            <div class="srRouteFact"><small>Odhad cesty</small><strong>${best.route.distanceKm.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km</strong></div>
            <div class="srRouteFact"><small>Váha cesty</small><strong>${a.money(best.transportWeight)} Kč</strong></div>
            <div class="srRouteFact"><small>Zastávky navíc</small><strong>${a.money(best.stopWeight)} Kč</strong></div>
            <div class="srRouteFact"><small>Položky</small><strong>${rows.length}</strong></div>
          </div>
          <p class="srRouteNote">Slevao optimalizuje pořadí pomocí přímých GPS vzdáleností, nikoli silniční navigace. Odkaz do Google Maps proto slouží až pro skutečnou silniční trasu a navigaci.</p>
        </article>
        <aside class="srRouteCompare">
          <h3>Proč tato varianta</h3>
          <div class="srRouteCompareRows">
            <div class="srRouteCompareRow"><span>Nejlepší nalezená varianta</span><strong>${a.money(best.effectiveCost)} Kč</strong></div>
            ${single ? `<div class="srRouteCompareRow"><span>Nejlevnější 1 obchod</span><strong>${a.money(single.effectiveCost)} Kč</strong></div>` : ''}
            ${singleDiff != null && singleDiff > .01 ? `<div class="srRouteCompareRow"><span>Výhoda proti 1 obchodu</span><strong>${a.money(singleDiff)} Kč</strong></div>` : ''}
            ${absolute ? `<div class="srRouteCompareRow"><span>Nejnižší košík v povoleném počtu obchodů</span><strong>${a.money(absolute.basketTotal)} Kč</strong></div>` : ''}
            ${absoluteDiff != null && absoluteDiff > .01 ? `<div class="srRouteCompareRow"><span>Cena pohodlí/cesty v rozhodnutí</span><strong>${a.money(absoluteDiff)} Kč</strong></div>` : ''}
          </div>
        </aside>
      </div>`;
    status(`Spočítáno z ${rows.length} propojených položek a skutečných GPS poboček v okolí.`, 'good');
  }

  async function calculate() {
    const a = api();
    const button = document.getElementById('srCalculate');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Počítám…';
    status('Zjišťuji polohu, pobočky a dnešní ceny…');
    document.getElementById('srResults').innerHTML = '';
    try {
      const rows = a.readList().filter((row) => !row.completed && row.product_id);
      if (!rows.length) throw new Error('Nejdřív přidejte do seznamu alespoň jeden produkt propojený s nabídkou Slevao.');
      const position = await a.getPosition();
      const maxStores = Math.max(1, Math.min(3, Number(document.getElementById('srMaxStores').value || 2)));
      const radius = Math.max(1, Number(document.getElementById('srRadius').value || 15));
      const kmCost = Math.max(0, Number(document.getElementById('srKmCost').value || 0));
      const stopCost = Math.max(0, Number(document.getElementById('srStopCost').value || 0));
      const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
      const nearestByStore = a.uniqueStores(branches);
      if (!nearestByStore.length) throw new Error('V tomto okruhu zatím nemáme evidovanou pobočku. Zkuste větší okruh.');
      const storeIds = nearestByStore.map((branch) => String(branch.store_id));
      const offers = await a.fetchOffersForList(rows, storeIds, branches);
      if (!offers.length) throw new Error('Pro položky ze seznamu nejsou v okolních řetězcích dostupné dnešní ceny.');
      const availableStoreIds = storeIds.filter((storeId) => offers.some((offer) => String(offer.store_id) === storeId));
      const branchByStore = new Map(nearestByStore.map((branch) => [String(branch.store_id), branch]));
      const plans = new Map();
      for (const combo of combinations(availableStoreIds, maxStores)) {
        const plan = planFor(combo, rows, offers, branchByStore, position, kmCost, stopCost);
        if (!plan) continue;
        const key = plan.usedStores.slice().sort().join('|');
        const current = plans.get(key);
        if (!current || plan.effectiveCost < current.effectiveCost) plans.set(key, plan);
      }
      const allPlans = [...plans.values()].sort((x, y) => x.effectiveCost - y.effectiveCost);
      const best = allPlans[0] || null;
      const single = allPlans.filter((plan) => plan.usedStores.length === 1).sort((x, y) => x.effectiveCost - y.effectiveCost)[0] || null;
      const absolute = [...plans.values()].sort((x, y) => x.basketTotal - y.basketTotal)[0] || null;
      render(best, single, absolute, rows);
    } catch (error) {
      status(error.message || 'Trasu se nepodařilo spočítat.', 'bad');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function init() {
    if (!api()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (api()) { clearInterval(timer); injectUi(); }
        else if (attempts >= 60) clearInterval(timer);
      }, 100);
      return;
    }
    injectUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
