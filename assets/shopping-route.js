(() => {
  'use strict';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
        <div class="srRouteTitle"><span class="srRouteBadge">GPS optimizer</span><h2>Nejvýhodnější nákup ve tvém okolí</h2><p>Porovná cenu celého košíku s cestou k reálným pobočkám a doporučí, zda se další zastávka opravdu vyplatí.</p></div>
        <div class="srGpsTrust"><span>⌖</span><div><b>Poloha zůstává v prohlížeči</b><small>Použije se pouze pro tento výpočet</small></div></div>
      </div>
      <div class="srRouteSteps" aria-label="Postup výpočtu"><span><b>1</b>Povolíš polohu</span><i>→</i><span><b>2</b>Porovnáme košík</span><i>→</i><span><b>3</b>Otevřeš navigaci</span></div>
      <div class="srPresetBar"><strong>Jak chceš nakupovat?</strong><div class="srPresets">
        <button type="button" class="srPreset" data-route-preset="quick">Co nejrychleji</button>
        <button type="button" class="srPreset active" data-route-preset="balanced">Vyváženě</button>
        <button type="button" class="srPreset" data-route-preset="saving">Největší úspora</button>
      </div></div>
      <div class="srRouteControls">
        <label><span>Maximum obchodů<small>Kolik zastávek připouštíš</small></span><select id="srMaxStores"><option value="1">1 obchod</option><option value="2" selected>2 obchody</option><option value="3">3 obchody</option></select></label>
        <label><span>Okruh hledání<small>Nejvzdálenější pobočka</small></span><select id="srRadius"><option value="5">5 km</option><option value="10">10 km</option><option value="15" selected>15 km</option><option value="25">25 km</option><option value="40">40 km</option></select></label>
        <label><span>Náklad cesty<small>Palivo a čas za kilometr</small></span><div class="srInputUnit"><input id="srKmCost" type="number" min="0" max="100" step="1" value="5"><b>Kč/km</b></div></label>
        <label><span>Cena zastávky<small>Čas navíc za další obchod</small></span><div class="srInputUnit"><input id="srStopCost" type="number" min="0" max="500" step="5" value="30"><b>Kč</b></div></label>
        <button id="srCalculate" class="srRouteButton" type="button"><span aria-hidden="true">⌖</span>Spočítat nejlepší trasu</button>
      </div>
      <div id="srStatus" class="srRouteStatus"><span aria-hidden="true">i</span><p>Po kliknutí požádáme o polohu. První odhad používá GPS vzdálenost; skutečnou silniční trasu potom otevře Google Maps.</p></div>
      <div id="srResults"></div>`;
    layout.parentNode.insertBefore(section, layout);
    const button = document.getElementById('srCalculate');
    if (sharedMode) {
      button.disabled = true;
      document.getElementById('srStatus').textContent = 'GPS trasa je zatím dostupná jen pro vlastní nákupní seznam. U sdíleného seznamu se záměrně nepoužívá localStorage, aby nevznikl výpočet z cizích nebo starých položek.';
    } else {
      button.addEventListener('click', calculate);
      const presets = {
        quick: { maxStores:'1', radius:'10', kmCost:'8', stopCost:'80' },
        balanced: { maxStores:'2', radius:'15', kmCost:'5', stopCost:'30' },
        saving: { maxStores:'3', radius:'25', kmCost:'3', stopCost:'10' },
      };
      section.querySelectorAll('[data-route-preset]').forEach((presetButton) => {
        presetButton.addEventListener('click', () => {
          const preset = presets[presetButton.dataset.routePreset];
          if (!preset) return;
          document.getElementById('srMaxStores').value = preset.maxStores;
          document.getElementById('srRadius').value = preset.radius;
          document.getElementById('srKmCost').value = preset.kmCost;
          document.getElementById('srStopCost').value = preset.stopCost;
          section.querySelectorAll('[data-route-preset]').forEach((item) => item.classList.toggle('active', item === presetButton));
        });
      });
    }
    return true;
  }

  function status(text, type = '') {
    const node = document.getElementById('srStatus');
    if (!node) return;
    node.innerHTML = `<span aria-hidden="true">${type === 'good' ? '✓' : type === 'bad' ? '!' : 'i'}</span><p>${esc(text)}</p>`;
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

  function offersForRow(row, offers, allowedStores) {
    const customKey = norm(row.custom_name || row.name);
    return (offers || [])
      .filter((candidate) => allowedStores.has(String(candidate.store_id)))
      .filter((candidate) => row.product_id
        ? String(candidate.product_id) === String(row.product_id)
        : Boolean(customKey) && String(candidate.__shopping_query_key || '') === customKey);
  }

  function compatibleBranchForStore(storeId, chosen, branches) {
    const storeOffers = chosen
      .filter((item) => String(item.offer.store_id) === String(storeId))
      .map((item) => item.offer);
    if (!storeOffers.length) return null;
    return (branches || [])
      .filter((branch) => String(branch.store_id) === String(storeId))
      .filter((branch) => storeOffers.every((offer) => api().coverageMatches(offer, [branch])))
      .sort((a, b) => Number(a.distance_km ?? Infinity) - Number(b.distance_km ?? Infinity))[0] || null;
  }

  function planFor(combo, rows, offers, branches, position, kmCost, stopCost) {
    const allowed = new Set(combo.map(String));
    const chosen = [];
    let basketTotal = 0;
    for (const row of rows) {
      const offer = offersForRow(row, offers, allowed)
        .slice()
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];
      if (!offer) return null;
      const subtotal = Number(offer.price || 0) * Math.max(.01, Number(row.quantity || 1));
      basketTotal += subtotal;
      chosen.push({ row, offer, subtotal });
    }
    const usedStores = [...new Set(chosen.map((item) => String(item.offer.store_id)))];
    const branchByStore = new Map();
    for (const storeId of usedStores) {
      const branch = compatibleBranchForStore(storeId, chosen, branches);
      if (!branch) return null;
      branchByStore.set(String(storeId), branch);
    }
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

  async function fetchCustomRouteOffers(rows, storeIds, branches) {
    const db = window.SlevaoSupabase?.getClient?.();
    const queries = [...new Set((rows || [])
      .filter((row) => !row.product_id)
      .map((row) => String(row.custom_name || row.name || '').trim())
      .filter(Boolean))];
    if (!db || !queries.length) return [];
    const { data, error } = await db.rpc('get_public_shopping_list_candidates', {
      p_queries: queries,
      p_limit_per_query: 30,
    });
    if (error) throw error;
    const today = api().TODAY;
    const allowed = new Set((storeIds || []).map(String));
    const output = [];
    for (const candidate of data || []) {
      const offer = candidate?.offer;
      if (!offer || Number(offer.price || 0) <= 0) continue;
      if (!allowed.has(String(offer.store_id))) continue;
      if (offer.valid_from && String(offer.valid_from) > today) continue;
      if (offer.valid_to && String(offer.valid_to) < today) continue;
      if (!api().coverageMatches(offer, branches)) continue;
      output.push({
        ...offer,
        __shopping_query_key: String(candidate.query_key || norm(candidate.query_text)),
      });
    }
    return output;
  }

  function render(best, single, absolute, rows) {
    const a = api();
    const results = document.getElementById('srResults');
    if (!best) {
      results.innerHTML = '';
      status('Pro zvolený okruh a počet obchodů chybí úplná kombinace dnešních cen pro všechny položky.', 'bad');
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
          <div class="srResultTop"><div><span class="srResultBadge">Doporučená varianta</span><h3>Nejvýhodnější plán nákupu</h3></div>${singleDiff != null && singleDiff > .01 ? `<div class="srSavingHero"><small>Ušetříš proti 1 obchodu</small><strong>${a.money(singleDiff)} Kč</strong></div>` : ''}</div>
          <div class="srRoutePrice">${a.money(best.basketTotal)} Kč <small>za nákup</small></div>
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
    status(`Spočítáno z ${rows.length} položek a poboček, na kterých jsou zvolené ceny skutečně platné.`, 'good');
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
      const rows = a.readList().filter((row) => !row.completed);
      if (!rows.length) throw new Error('Nejdřív přidejte do seznamu alespoň jednu položku.');
      const position = await a.getPosition();
      const maxStores = Math.max(1, Math.min(3, Number(document.getElementById('srMaxStores').value || 2)));
      const radius = Math.max(1, Number(document.getElementById('srRadius').value || 15));
      const kmCost = Math.max(0, Number(document.getElementById('srKmCost').value || 0));
      const stopCost = Math.max(0, Number(document.getElementById('srStopCost').value || 0));
      const branches = await a.fetchNearbyBranches(position.latitude, position.longitude, radius);
      const nearestByStore = a.uniqueStores(branches);
      if (!nearestByStore.length) throw new Error('V tomto okruhu zatím nemáme evidovanou pobočku. Zkuste větší okruh.');
      const storeIds = nearestByStore.map((branch) => String(branch.store_id));
      const [productOffers, customOffers] = await Promise.all([
        a.fetchOffersForList(rows, storeIds, branches),
        fetchCustomRouteOffers(rows, storeIds, branches),
      ]);
      const offers = [...productOffers, ...customOffers];
      if (!offers.length) throw new Error('Pro položky ze seznamu nejsou v okolních řetězcích dostupné dnešní ceny.');
      const availableStoreIds = storeIds.filter((storeId) => offers.some((offer) => String(offer.store_id) === storeId));
      const plans = new Map();
      for (const combo of combinations(availableStoreIds, maxStores)) {
        const plan = planFor(combo, rows, offers, branches, position, kmCost, stopCost);
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