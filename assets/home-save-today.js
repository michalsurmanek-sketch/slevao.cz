(() => {
  'use strict';

  const BRIEF_KEY = 'slevao-savings-brief-v1';
  const LIVE_PLACE_KEY = 'slevao-live-place-v1';
  const PAGE_SIZE = 1000;
  const TRAVEL_KM_COST = 5;
  const EXTRA_STOP_COST = 30;
  const TEMPLATES = {
    grill: {
      title: 'Grilování', icon: '🔥',
      defaultRequest: 'Grilování pro rodinu nebo přátele',
      items: [
        ['Kuřecí maso',['kureci','kure']],
        ['Vepřové na gril',['krkov','veprove']],
        ['Klobása',['klobas']],
        ['Pečivo',['rohlik','chleb','baget','peciv']],
        ['Paprika',['paprik']],
        ['Rajčata',['rajcat']],
        ['Nealko nápoj',['cola','limonad','dzus']],
        ['Voda',['voda']]
      ]
    },
    weekly: {
      title: 'Týdenní základ', icon: '🛒',
      defaultRequest: 'Základní týdenní nákup domácnosti',
      items: [
        ['Mléko',['mleko']],
        ['Vejce',['vejce']],
        ['Máslo',['maslo']],
        ['Sýr',['syr']],
        ['Pečivo',['rohlik','chleb','baget','peciv']],
        ['Kuřecí maso',['kureci','kure']],
        ['Brambory',['brambor']],
        ['Banány',['banan']],
        ['Rajčata',['rajcat']]
      ]
    },
    custom: { title:'Vlastní zadání', icon:'✦', defaultRequest:'', items:[] }
  };

  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const localDate = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

  let selected = 'grill';

  async function getApi(timeout = 5000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic;
    }
    throw new Error('Datové služby se ještě nenačetly.');
  }

  async function getLocationApi(timeout = 5000) {
    if (window.SlevaoLocation) return window.SlevaoLocation;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoLocation) return window.SlevaoLocation;
    }
    throw new Error('Geolokační vrstva se ještě nenačetla.');
  }

  function saveBrief(modal) {
    const locationMode = modal.querySelector('#sqSaveLocationMode').value;
    const place = modal.querySelector('#sqSavePlace').value.trim();
    const brief = {
      version: 2,
      scenario: selected,
      request: modal.querySelector('#sqSaveRequest').value.trim(),
      people: Math.max(1, Number(modal.querySelector('#sqSavePeople').value || 1)),
      budget: Math.max(0, Number(modal.querySelector('#sqSaveBudget').value || 0)),
      location_mode: locationMode,
      place,
      radius_km: Math.max(1, Number(modal.querySelector('#sqSaveRadius').value || 15)),
      max_stores: Math.max(1, Math.min(3, Number(modal.querySelector('#sqSaveMaxStores').value || 2))),
      created_at: new Date().toISOString()
    };
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify(brief));
      if (locationMode === 'manual' && place) localStorage.setItem(LIVE_PLACE_KEY, place);
    } catch {}
    return brief;
  }

  async function loadCurrentOffers() {
    const api = await getApi();
    const db = await api.getSupabase();
    const today = localDate();
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db.from('offers')
        .select('id,product_id,store_id,title,price,old_price,image_url,valid_from,valid_to,coverage_scope,region_code,city_name,branch_id,products(id,name,brand,quantity_text,image_url),stores(id,name,slug)')
        .eq('status', 'published')
        .lte('valid_from', today)
        .gte('valid_to', today)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async function loadPlanningContext(modal, brief) {
    const mode = brief.location_mode;
    if (mode === 'all') {
      return { mode, offers: await loadCurrentOffers(), branches: [], uniqueBranches: [], position: null, place: '' };
    }

    const geo = await getLocationApi();
    let branches = [];
    let position = null;
    let place = brief.place;

    if (mode === 'manual') {
      if (!place) throw new Error('Zadejte město nebo PSČ.');
      branches = await geo.searchBranchesByPlace(place);
    } else {
      position = await geo.getPosition();
      branches = await geo.fetchNearbyBranches(position.latitude, position.longitude, brief.radius_km);
    }

    const uniqueBranches = geo.uniqueStores(branches);
    if (!uniqueBranches.length) {
      throw new Error(mode === 'manual'
        ? 'Pro zadané město nebo PSČ zatím nemáme ověřenou pobočku.'
        : 'V tomto okruhu zatím nemáme ověřenou pobočku. Zkuste větší okruh.');
    }

    const offers = await geo.fetchOffersForStores(uniqueBranches.map((branch) => branch.store_id), branches);
    return { mode, offers, branches, uniqueBranches, position, place };
  }

  function offerText(offer) {
    return fold([offer.title, offer.products?.name, offer.products?.brand, offer.products?.quantity_text].filter(Boolean).join(' '));
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
    if (!position || !storeIds.length || storeIds.length > 3) return null;
    const geo = window.SlevaoLocation;
    const branches = storeIds.map((id) => branchByStore.get(String(id))).filter(Boolean);
    if (branches.length !== storeIds.length) return null;
    let best = null;
    for (const order of permutations(branches)) {
      let distance = 0;
      let lat = position.latitude;
      let lon = position.longitude;
      for (const branch of order) {
        distance += geo.distanceKm(lat, lon, branch.latitude, branch.longitude);
        lat = Number(branch.latitude);
        lon = Number(branch.longitude);
      }
      if (!best || distance < best.distanceKm) best = { distanceKm: distance, order };
    }
    return best;
  }

  function matchingCandidates(template, offers) {
    return template.items.map(([label, terms]) => ({
      label,
      terms,
      offers: offers.filter((offer) => {
        if (!offer.product_id || !Number.isFinite(Number(offer.price)) || Number(offer.price) <= 0) return false;
        const text = offerText(offer);
        return terms.some((term) => text.includes(fold(term)));
      })
    }));
  }

  function planForStores(template, matched, combo, context) {
    const allowed = new Set(combo.map(String));
    const usedProducts = new Set();
    const selectedRows = [];
    const missing = [];
    let total = 0;
    let reference = 0;

    for (const item of matched) {
      const candidates = item.offers
        .filter((offer) => allowed.has(String(offer.store_id)) && !usedProducts.has(String(offer.product_id)))
        .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
      const best = candidates[0];
      if (!best) { missing.push(item.label); continue; }
      usedProducts.add(String(best.product_id));
      selectedRows.push({ label: item.label, offer: best });
      const price = Number(best.price || 0);
      const oldPrice = Number(best.old_price || 0);
      total += price;
      reference += oldPrice > price ? oldPrice : price;
    }

    const usedStores = [...new Set(selectedRows.map((row) => String(row.offer.store_id)))];
    const branchByStore = new Map((context.uniqueBranches || []).map((branch) => [String(branch.store_id), branch]));
    const route = routeForStores(usedStores, branchByStore, context.position);
    const travelWeight = route ? route.distanceKm * TRAVEL_KM_COST : 0;
    const stopWeight = Math.max(0, usedStores.length - 1) * EXTRA_STOP_COST;
    const effectiveCost = total + travelWeight + stopWeight;

    return {
      template,
      selectedRows,
      missing,
      matchedCount: selectedRows.length,
      total,
      reference,
      savings: Math.max(0, reference - total),
      usedStores,
      route,
      travelWeight,
      stopWeight,
      effectiveCost
    };
  }

  function selectBestPlan(template, offers, context, maxStores) {
    const matched = matchingCandidates(template, offers);
    const availableStoreIds = [...new Set(matched.flatMap((item) => item.offers.map((offer) => String(offer.store_id))).filter(Boolean))];
    if (!availableStoreIds.length) return null;

    const plans = combinations(availableStoreIds, Math.min(maxStores, 3))
      .map((combo) => planForStores(template, matched, combo, context))
      .filter((plan) => plan.matchedCount > 0);

    if (!plans.length) return null;
    plans.sort((a, b) => {
      if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
      if (a.effectiveCost !== b.effectiveCost) return a.effectiveCost - b.effectiveCost;
      return a.usedStores.length - b.usedStores.length;
    });
    return plans[0];
  }

  function routeUrl(plan, context) {
    if (!plan?.route?.order?.length || !context?.position) return '';
    const origin = `${context.position.latitude},${context.position.longitude}`;
    const stops = plan.route.order.map((branch) => `${branch.latitude},${branch.longitude}`);
    const destination = stops.at(-1);
    const waypoints = stops.slice(0, -1);
    const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' });
    if (waypoints.length) params.set('waypoints', waypoints.join('|'));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  function resultClass(total, budget) {
    if (!budget) return 'good';
    return total <= budget ? 'good' : 'warn';
  }

  function storeSummary(plan, context) {
    if (!plan?.usedStores?.length) return '';
    const geo = window.SlevaoLocation;
    const branchByStore = new Map((context.uniqueBranches || []).map((branch) => [String(branch.store_id), branch]));
    const names = plan.route?.order?.length
      ? plan.route.order.map((branch) => branch.stores?.name || branch.name || 'Obchod')
      : plan.usedStores.map((id) => {
          const branch = branchByStore.get(String(id));
          return branch?.stores?.name || branch?.name || plan.selectedRows.find((row) => String(row.offer.store_id) === String(id))?.offer?.stores?.name || 'Obchod';
        });
    return names.join(' → ');
  }

  function basketRowsHtml(plan) {
    return `<div class="sqSaveBasket">${plan.selectedRows.map(({ label, offer }) => {
      const store = offer.stores?.name || 'Obchod';
      const image = offer.image_url || offer.products?.image_url || '';
      const media = image
        ? `<span class="sqSaveBasketMedia"><img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-empty');this.remove()"></span>`
        : '<span class="sqSaveBasketMedia is-empty" aria-hidden="true">🏷️</span>';
      return `<div class="sqSaveBasketRow">${media}<span class="sqSaveBasketProduct"><small>${esc(label)}</small><b>${esc(offer.title || label)}</b></span><span class="sqSaveBasketPrice"><small>${esc(store)}</small><strong>${money(offer.price)} Kč</strong></span></div>`;
    }).join('')}</div>`;
  }

  function scrollPlannerToResults(modal) {
    const box = modal.querySelector('.sqSaveBox');
    const actions = modal.querySelector('.sqSaveActions');
    if (!box || !actions) return;
    const top = Math.max(0, actions.offsetTop - box.offsetTop - 12);
    requestAnimationFrame(() => box.scrollTo({
      top,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    }));
  }

  async function runTemplate(modal, brief) {
    const result = modal.querySelector('#sqSaveResult');
    const action = modal.querySelector('#sqSaveAction');
    action.disabled = true;
    action.textContent = brief.location_mode === 'gps' ? 'Hledám obchody kolem vás…' : 'Hledám dnešní akce…';
    result.className = 'sqSaveResult';
    result.innerHTML = '<strong>Sestavuji lokální nákup</strong>Načítám jen skutečné pobočky a právě platné ceny.';
    scrollPlannerToResults(modal);
    try {
      const api = await getApi();
      const context = await loadPlanningContext(modal, brief);
      const template = TEMPLATES[selected];
      const plan = selectBestPlan(template, context.offers, context, brief.max_stores);
      if (!plan?.selectedRows?.length) throw new Error('Pro tuto šablonu dnes nebyly nalezeny propojené nabídky ve zvoleném rozsahu.');

      const currentList = api.readList?.() || [];
      const currentProducts = new Set(currentList.filter((row) => !row.completed && row.product_id).map((row) => String(row.product_id)));
      let added = 0;
      let already = 0;
      plan.selectedRows.forEach(({ offer }) => {
        if (currentProducts.has(String(offer.product_id))) { already++; return; }
        if (api.addItemFromOffer?.(offer)) {
          added++;
          currentProducts.add(String(offer.product_id));
        }
      });

      const budgetText = brief.budget
        ? (plan.total <= brief.budget
          ? ` Košík je o ${money(brief.budget - plan.total)} Kč pod zadaným rozpočtem.`
          : ` Košík je o ${money(plan.total - brief.budget)} Kč nad zadaným rozpočtem.`)
        : '';
      const modeText = context.mode === 'all'
        ? 'Výběr je z celé ČR; konkrétní pobočku je potřeba ověřit v nákupní trase.'
        : context.mode === 'manual'
          ? `Výběr je omezen na evidované pobočky pro „${context.place}“.`
          : `Výběr je omezen na skutečné pobočky do ${brief.radius_km} km od vaší GPS polohy.`;
      const stores = storeSummary(plan, context);
      const route = routeUrl(plan, context);
      const routeText = plan.route
        ? ` Odhad přímé GPS trasy je ${plan.route.distanceKm.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km; rozhodovací náklad se započtením ${TRAVEL_KM_COST} Kč/km a ${EXTRA_STOP_COST} Kč za další zastávku je ${money(plan.effectiveCost)} Kč.`
        : '';
      const routeLink = route
        ? `<a href="${esc(route)}" target="_blank" rel="noopener">Otevřít trasu v Google Maps →</a><br>`
        : '';
      const missingText = plan.missing.length ? ` Nenalezeno: ${plan.missing.join(', ')}.` : '';
      const basketHtml = basketRowsHtml(plan);

      result.className = `sqSaveResult ${resultClass(plan.total, brief.budget)}`;
      result.innerHTML = `<strong>${esc(template.title)}: ${money(plan.total)} Kč · ${plan.usedStores.length} ${plan.usedStores.length === 1 ? 'obchod' : plan.usedStores.length < 5 ? 'obchody' : 'obchodů'}</strong>
        Doložená úspora z původních cen: ${money(plan.savings)} Kč.${esc(budgetText)}${esc(routeText)}
        ${basketHtml}
        <b>Obchody:</b> ${esc(stores || 'podle nalezených nabídek')}. Přidáno ${added} nových položek${already ? `, ${already} už v seznamu` : ''}.${esc(missingText)}<br>
        <small>${esc(modeText)} Jde o transparentní šablonu po 1 balení nalezeného produktu, ne AI odhad množství pro ${brief.people} osob. Množství uprav podle konkrétní gramáže.</small><br>
        ${routeLink}<a href="seznam.html?route=1">Otevřít seznam a dopočítat nejlevnější trasu →</a>`;
    } catch (error) {
      result.className = 'sqSaveResult bad';
      result.innerHTML = `<strong>Košík se nepodařilo sestavit</strong>${esc(error?.message || 'Zkus to znovu.')}`;
    } finally {
      scrollPlannerToResults(modal);
      action.disabled = false;
      action.textContent = 'Najít nejlevnější lokální nákup';
    }
  }

  function selectScenario(modal, key) {
    selected = key;
    modal.querySelectorAll('[data-sq-scenario]').forEach((button) => button.classList.toggle('active', button.dataset.sqScenario === key));
    const template = TEMPLATES[key];
    const request = modal.querySelector('#sqSaveRequest');
    if (!request.value.trim() || Object.values(TEMPLATES).some((item) => item.defaultRequest === request.value.trim())) request.value = template.defaultRequest;
    modal.querySelector('#sqSaveAction').textContent = key === 'custom' ? 'Uložit zadání' : 'Najít nejlevnější lokální nákup';
    modal.querySelector('#sqSaveResult').hidden = true;
  }

  function toggleLocationFields(modal) {
    const mode = modal.querySelector('#sqSaveLocationMode').value;
    modal.querySelector('#sqSavePlaceField').hidden = mode !== 'manual';
    modal.querySelector('#sqSaveRadiusField').hidden = mode !== 'gps';
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function openModal(modal) {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.sqSaveClose')?.focus({ preventScroll:true });
  }

  function createModal() {
    const modal = document.createElement('div');
    modal.className = 'sqSaveModal';
    modal.hidden = true;
    const savedPlace = (() => {
      try { return localStorage.getItem(LIVE_PLACE_KEY) || ''; } catch { return ''; }
    })();
    modal.innerHTML = `
      <div class="sqSaveBox" role="dialog" aria-modal="true" aria-labelledby="sqSaveTitle">
        <div class="sqSaveHead"><div><small>Chytrý lokální nákup bez falešné AI</small><h2 id="sqSaveTitle">Ušetři mi dnes peníze</h2></div><button class="sqSaveClose" type="button" aria-label="Zavřít">×</button></div>
        <div class="sqSaveScenarios">
          <button class="sqSaveScenario active" type="button" data-sq-scenario="grill"><span>🔥</span>Grilování<small>Vybere dnešní akce pro základní grilovací košík.</small></button>
          <button class="sqSaveScenario" type="button" data-sq-scenario="weekly"><span>🛒</span>Týdenní základ<small>Najde běžné základní potraviny v dnešních akcích.</small></button>
          <button class="sqSaveScenario" type="button" data-sq-scenario="custom"><span>✦</span>Vlastní zadání<small>Uloží zadání pro budoucí chytrý planner bez vymyšlené odpovědi.</small></button>
        </div>
        <div class="sqSaveFields">
          <label class="sqSaveField full">Co plánuješ?<textarea id="sqSaveRequest" placeholder="Např. Grilování pro 6 lidí do 1200 Kč">${TEMPLATES.grill.defaultRequest}</textarea></label>
          <label class="sqSaveField">Počet lidí<input id="sqSavePeople" type="number" min="1" max="30" value="4"></label>
          <label class="sqSaveField">Rozpočet v Kč<input id="sqSaveBudget" type="number" min="0" step="50" placeholder="Např. 1200"></label>
          <label class="sqSaveField">Lokalita<select id="sqSaveLocationMode"><option value="gps" selected>Moje poloha (GPS)</option><option value="manual">Město nebo PSČ</option><option value="all">Celá ČR</option></select></label>
          <label id="sqSaveRadiusField" class="sqSaveField">Okruh<select id="sqSaveRadius"><option value="5">5 km</option><option value="10">10 km</option><option value="15" selected>15 km</option><option value="25">25 km</option><option value="40">40 km</option></select></label>
          <label id="sqSavePlaceField" class="sqSaveField full" hidden>Město nebo PSČ<input id="sqSavePlace" type="text" value="${esc(savedPlace)}" placeholder="Např. Uherské Hradiště nebo 686 01"></label>
          <label class="sqSaveField">Max. obchodů<select id="sqSaveMaxStores"><option value="1">1 obchod</option><option value="2" selected>2 obchody</option><option value="3">3 obchody</option></select></label>
        </div>
        <div class="sqSaveActions"><button class="sqSaveAction" type="button" data-sq-cancel>Zrušit</button><button id="sqSaveAction" class="sqSaveAction primary" type="button">Najít nejlevnější lokální nákup</button></div>
        <div id="sqSaveResult" class="sqSaveResult" hidden></div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-sq-scenario]').forEach((button) => button.addEventListener('click', () => selectScenario(modal, button.dataset.sqScenario)));
    modal.querySelector('#sqSaveLocationMode').addEventListener('change', () => toggleLocationFields(modal));
    modal.querySelector('.sqSaveClose').addEventListener('click', () => closeModal(modal));
    modal.querySelector('[data-sq-cancel]').addEventListener('click', () => closeModal(modal));
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeModal(modal); });
    modal.querySelector('#sqSaveAction').addEventListener('click', async () => {
      const brief = saveBrief(modal);
      const result = modal.querySelector('#sqSaveResult');
      result.hidden = false;
      if (selected === 'custom') {
        result.className = 'sqSaveResult good';
        result.innerHTML = '<strong>Zadání je uložené</strong>Vlastní požadavek zatím neposíláme do žádné falešné AI. Datová struktura včetně lokality, rozpočtu a max. počtu obchodů je připravená pro budoucí planner.<br><a href="seznam.html?route=1">Otevřít nákupní seznam →</a>';
        return;
      }
      await runTemplate(modal, brief);
    });
    toggleLocationFields(modal);
    return modal;
  }

  function init() {
    if (document.querySelector('.sqSaveTodayButton')) return;
    const stats = document.querySelector('.heroStats');
    if (!stats) return;
    const modal = createModal();
    const wrap = document.createElement('div');
    wrap.className = 'sqSaveTodayWrap';
    wrap.innerHTML = '<button class="sqSaveTodayButton" type="button"><span>✦</span>Ušetři mi dnes peníze</button><small class="sqSaveTodayHint">Reálné dnešní ceny · skutečné pobočky · trasa</small>';
    stats.after(wrap);
    wrap.querySelector('.sqSaveTodayButton').addEventListener('click', () => openModal(modal));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
