(() => {
  'use strict';

  const PLACE_KEY = 'slevao-live-place-v1';
  let lastContext = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function loc() {
    return window.SlevaoLocation || null;
  }

  function showResult(show = true) {
    const result = document.getElementById('slevaoLive');
    if (!result) return;
    result.hidden = !show;
    result.closest('.heroCard')?.classList.toggle('slLiveHasResult', show);
  }

  function setResultMessage(text) {
    const node = document.getElementById('slLiveContext');
    if (!node) return;
    node.innerHTML = `<span>${esc(text)}</span>`;
  }

  function setSaving(value = '—') {
    const metric = document.querySelector('#slevaoLive .slLiveMetric');
    const node = document.getElementById('slLiveSaving');
    if (node) node.textContent = value;
    if (metric) metric.hidden = value === '—';
  }

  function resetLocateButton() {
    const button = document.getElementById('slLiveLocate');
    if (!button) return;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.textContent === 'Určuji polohu…') button.textContent = 'Použít moji polohu';
    delete button.dataset.locating;
  }

  function createUi() {
    const heroCard = document.querySelector('.heroCard');
    const host = heroCard?.querySelector('.heroLocation');
    if (!heroCard || !host) return false;

    if (host.dataset.nearbyReady !== '1') {
      const legacyRegion = document.getElementById('regionSelect');
      const legacyCity = document.getElementById('citySelect');
      const legacy = document.createElement('div');
      legacy.className = 'slLiveLegacyRegion';
      legacy.hidden = true;
      if (legacyRegion) legacy.appendChild(legacyRegion);
      if (legacyCity) legacy.appendChild(legacyCity);

      host.classList.add('heroNearbyPanel');
      host.dataset.nearbyReady = '1';
      host.innerHTML = `
        <div class="slLiveTopline"><span class="slLiveBadge"><i class="slLiveDot"></i>POBLÍŽ VÁS</span></div>
        <strong>Najít obchody poblíž</strong>
        <p>Zadejte město nebo PSČ, případně použijte svoji polohu.</p>
        <div class="slLiveOptions">
          <label>Okruh<select id="slLiveRadius" class="slLiveRadius"><option value="5">5 km</option><option value="10">10 km</option><option value="15" selected>15 km</option><option value="25">25 km</option><option value="40">40 km</option></select></label>
          <button id="slLiveLocate" class="slLiveLocationButton" type="button">Použít moji polohu</button>
        </div>
        <div class="slLiveDivider">nebo ručně</div>
        <form id="slLiveManual" class="slLiveManual"><input id="slLivePlace" type="text" autocomplete="postal-code" placeholder="Město nebo PSČ"><button type="submit">Najít</button></form>
        <div id="slLiveStatus" class="slLiveStatus" role="status" aria-live="polite">Výsledek se zobrazí až po vyhledání.</div>`;
      host.appendChild(legacy);
    }

    let result = document.getElementById('slevaoLive');
    if (!result) {
      result = document.createElement('section');
      result.id = 'slevaoLive';
      result.className = 'slLiveHeroResult';
      result.hidden = true;
      result.setAttribute('aria-label', 'Výsledek hledání obchodů v okolí');
      result.innerHTML = `
        <button id="slLiveClose" class="slLiveClose" type="button" aria-label="Skrýt výsledek">×</button>
        <div class="slLiveTopline"><span class="slLiveBadge"><i class="slLiveDot"></i>SLEVAO LIVE</span></div>
        <h2>Obchody v okolí</h2>
        <div class="slLiveMetric" hidden><small>NA NÁKUPU MŮŽETE UŠETŘIT AŽ</small><strong id="slLiveSaving">—</strong></div>
        <div id="slLiveContext" class="slLiveContext"><span>Hledám nejbližší evidované obchody…</span></div>
        <div id="slLiveStores" class="slLiveStores"></div>
        <div id="slLiveDeals" class="slLiveDeals slLiveNearbyDeals" hidden></div>`;
      heroCard.insertBefore(result, host);
    }

    resetLocateButton();
    bind();
    const saved = localStorage.getItem(PLACE_KEY) || '';
    const place = document.getElementById('slLivePlace');
    if (saved && place && !place.value) place.value = saved;
    return true;
  }

  function setStatus(text, type = '') {
    const node = document.getElementById('slLiveStatus');
    if (!node) return;
    node.textContent = text;
    node.className = `slLiveStatus${type ? ` ${type}` : ''}`;
  }

  function renderStoreTags(branches, hasDistances) {
    const api = loc();
    const node = document.getElementById('slLiveStores');
    if (!api || !node) return;
    const stores = api.uniqueStores(branches).slice(0, 5);
    node.innerHTML = stores.map((branch) => {
      const distance = hasDistances && Number.isFinite(Number(branch.distance_km)) ? ` · ${Number(branch.distance_km).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km` : '';
      const slug = String(branch.stores?.slug || branch.store_slug || '').trim();
      const label = `${esc(branch.stores?.name || branch.name || 'Obchod')}${esc(distance)}`;
      return slug
        ? `<a class="slLiveStoreTag" href="${encodeURIComponent(slug)}.html" aria-label="Otevřít obchod ${esc(branch.stores?.name || branch.name || 'Obchod')}">${label}</a>`
        : `<span class="slLiveStoreTag">${label}</span>`;
    }).join('');
  }

  function currentStoreMessage(branches, position) {
    if (!position || !branches.length) return null;
    const nearest = branches[0];
    const meters = nearest.distance_km * 1000;
    const accuracy = Math.max(0, Number(position.accuracy || 0));
    const name = nearest.stores?.name || nearest.name || 'obchodu';
    if (accuracy > 0 && accuracy <= 45 && meters <= Math.max(55, accuracy * 1.35)) {
      return { branch: nearest, text: `Podle GPS jste pravděpodobně v ${name}. Přesnost polohy je přibližně ±${Math.round(accuracy)} m.` };
    }
    if (meters <= 300) {
      return { branch: nearest, text: `Zdá se, že jste poblíž ${name} · přibližně ${Math.max(10, Math.round(meters / 10) * 10)} m.` };
    }
    return { branch: null, text: `Nejbližší evidovaná pobočka je ${name} · ${nearest.distance_km.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km.` };
  }

  function cheaperElsewhereText(currentBranch, branches, metrics, offers) {
    if (!currentBranch || !metrics?.chosen?.length) return null;
    const currentStoreId = String(currentBranch.store_id || '');
    let count = 0;
    const competitorStoreIds = new Set();
    for (const choice of metrics.chosen) {
      const productId = String(choice.row.product_id || '');
      const current = offers.filter((offer) => String(offer.product_id) === productId && String(offer.store_id) === currentStoreId).sort((a,b) => Number(a.price) - Number(b.price))[0];
      if (!current) continue;
      const cheaper = offers.filter((offer) => String(offer.product_id) === productId && String(offer.store_id) !== currentStoreId && Number(offer.price) < Number(current.price) * .98).sort((a,b) => Number(a.price) - Number(b.price))[0];
      if (!cheaper) continue;
      count++;
      competitorStoreIds.add(String(cheaper.store_id));
    }
    if (!count) return null;
    const competitorBranches = branches.filter((branch) => competitorStoreIds.has(String(branch.store_id))).sort((a,b) => Number(a.distance_km ?? Infinity) - Number(b.distance_km ?? Infinity));
    const nearest = competitorBranches[0];
    const distance = nearest && Number.isFinite(Number(nearest.distance_km)) ? ` Nejbližší takový obchod je asi ${Number(nearest.distance_km).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km odsud.` : '';
    return `${count} ${count === 1 ? 'položka je' : count < 5 ? 'položky jsou' : 'položek je'} dnes levnější v jiném blízkém řetězci.${distance}`;
  }

  function renderLiveDeals(branches, offers, hasDistances) {
    const api = loc();
    const node = document.getElementById('slLiveDeals');
    if (!api || !node) return;
    const nearest = api.uniqueStores(branches).slice(0, 8);
    const offerCount = (branch) => offers.filter((offer) => String(offer.store_id) === String(branch.store_id)).length;
    const chosen = [
      ...nearest.filter((branch) => offerCount(branch) > 0),
      ...nearest.filter((branch) => offerCount(branch) === 0),
    ].slice(0, 4);

    node.hidden = false;
    node.innerHTML = chosen.map((branch) => {
      const storeOffers = api.rankOffers(offers.filter((offer) => String(offer.store_id) === String(branch.store_id)), 1);
      const best = storeOffers[0];
      const storeName = branch.stores?.name || branch.name || 'Obchod';
      const distance = hasDistances && Number.isFinite(Number(branch.distance_km))
        ? `${Number(branch.distance_km).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km`
        : 'v zadané lokalitě';
      const address = [branch.street, branch.city].filter(Boolean).join(', ');
      const slug = String(branch.stores?.slug || branch.store_slug || '').trim();
      const bestDeal = best ? `<span class="slLiveNearbyDeal">${esc(best.title || 'Akční nabídka')} · <b>${api.money(best.price)} Kč</b></span>` : '<span class="slLiveNearbyDeal muted">Aktuální nabídka není načtená.</span>';
      const content = `
        <div class="slLiveNearbyMain"><span class="slLiveStoreDistance">${esc(distance)}</span><strong>${esc(storeName)}</strong><small>${esc(address || 'Evidovaná pobočka')}</small>${bestDeal}</div>
        <span class="slLiveStoreCount">${offerCount(branch)} akcí</span>`;
      return slug
        ? `<a class="slLiveNearbyRow" href="${encodeURIComponent(slug)}.html" aria-label="Otevřít nabídky obchodu ${esc(storeName)}">${content}</a>`
        : `<article class="slLiveNearbyRow">${content}</article>`;
    }).join('');
  }

  async function evaluate(branches, context = {}) {
    const api = loc();
    const unique = api.uniqueStores(branches);
    showResult(true);
    renderStoreTags(branches, Boolean(context.position));
    lastContext = { branches, ...context };

    if (!unique.length) {
      setSaving('—');
      document.getElementById('slLiveContext').innerHTML = '<span>V této oblasti zatím nemáme žádnou spolehlivě evidovanou pobočku.</span>';
      document.getElementById('slLiveDeals').hidden = true;
      setStatus('Pobočky pro tuto oblast zatím chybí. Zkuste větší okruh nebo jiné město.', 'bad');
      return;
    }

    const list = api.readList();
    const linked = list.filter((row) => !row.completed && row.product_id);
    const current = currentStoreMessage(branches, context.position);
    const lines = [];
    if (current?.text) lines.push(`<strong>${esc(current.text)}</strong>`);
    lines.push(`${unique.length} ${unique.length === 1 ? 'řetězec' : unique.length < 5 ? 'řetězce' : 'řetězců'} v zadaném okolí.`);

    const dealsNode = document.getElementById('slLiveDeals');
    dealsNode.hidden = false;
    dealsNode.innerHTML = '<div class="slLiveDealsLoading">Načítám dnešní akce okolních obchodů…</div>';
    setStatus('Pobočky nalezeny. Načítám jejich dnešní nabídky…');

    let offers = [];
    try {
      offers = await api.fetchOffersForStores(unique.map((branch) => branch.store_id), branches);
      renderLiveDeals(branches, offers, Boolean(context.position));
      lines.push(`${offers.length} dnešních nabídek odpovídá nalezeným řetězcům a jejich územní platnosti.`);
    } catch (error) {
      dealsNode.innerHTML = '<div class="slLiveDealsLoading">Pobočky jsme našli, ale dnešní nabídky se právě nepodařilo načíst.</div>';
      lines.push('Pobočky jsou ověřené, dnešní nabídky se ale právě nepodařilo načíst.');
    }

    if (!linked.length) {
      setSaving('—');
      document.getElementById('slLiveContext').innerHTML = lines.map((line) => `<span>${line}</span>`).join('');
      setStatus(offers.length ? 'Zobrazuji nejbližší evidované obchody a jejich dnešní akce.' : 'Nalezené pobočky jsou připravené; konkrétní dnešní akce teď nejsou dostupné.', offers.length ? 'good' : '');
      return;
    }

    const productIds = new Set(linked.map((row) => String(row.product_id)));
    const listOffers = offers.filter((offer) => productIds.has(String(offer.product_id)));
    const metrics = api.basketMetrics(linked, listOffers);
    setSaving(metrics.matchedCount ? `${api.money(metrics.savings)} Kč` : '—');
    lines.push(`Cenu se podařilo najít pro ${metrics.matchedCount} z ${metrics.itemCount} propojených položek.`);
    if (metrics.bestSingleStore) lines.push(`Nejvýhodnější jeden obchod pro celý porovnatelný nákup: <strong>${esc(metrics.bestSingleStore.store_name)} · ${api.money(metrics.bestSingleStore.total)} Kč</strong>.`);
    const cheaper = cheaperElsewhereText(current?.branch, branches, metrics, listOffers);
    if (cheaper) lines.push(esc(cheaper));
    document.getElementById('slLiveContext').innerHTML = lines.map((line) => `<span>${line}</span>`).join('');
    setStatus(metrics.matchedCount ? 'Výsledek počítá z dnešních cen a skutečně evidovaných poboček.' : 'V okolních řetězcích nejsou pro položky ze seznamu dohledané dnešní ceny.', metrics.matchedCount ? 'good' : '');
  }

  async function usePosition() {
    const api = loc();
    const button = document.getElementById('slLiveLocate');
    if (!api || !button || button.dataset.locating === '1') return;

    showResult(true);
    setResultMessage('Zjišťuji polohu a hledám nejbližší obchody…');
    const old = button.textContent;
    button.dataset.locating = '1';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Určuji polohu…';
    setStatus('Zjišťuji polohu a hledám skutečné pobočky…');

    let position = null;
    let radius = 15;
    let branches = null;

    try {
      position = await api.getPosition();
      radius = Number(document.getElementById('slLiveRadius')?.value || 15);
      branches = await api.fetchNearbyBranches(position.latitude, position.longitude, radius);
    } catch (error) {
      setSaving('—');
      setResultMessage(error.message || 'Polohu se nepodařilo použít. Zadejte město nebo PSČ.');
      const deals = document.getElementById('slLiveDeals');
      if (deals) deals.hidden = true;
      setStatus(error.message || 'Polohu se nepodařilo použít. Zadejte město nebo PSČ.', 'bad');
      return;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = old;
      delete button.dataset.locating;
    }

    setStatus('Poloha nalezena. Načítám obchody a dnešní nabídky…', 'good');
    try {
      await evaluate(branches || [], { position, radius });
    } catch (error) {
      setSaving('—');
      setResultMessage(error?.message || 'Pobočky se podařilo najít, ale nabídky se právě nepodařilo načíst.');
      setStatus(error?.message || 'Pobočky se podařilo najít, ale nabídky se právě nepodařilo načíst.', 'bad');
    }
  }

  async function useManual(event) {
    event.preventDefault();
    const api = loc();
    const input = document.getElementById('slLivePlace');
    const term = input?.value.trim() || '';
    if (!term) { input?.focus(); showResult(false); return; }
    localStorage.setItem(PLACE_KEY, term);
    showResult(true);
    setResultMessage(`Hledám obchody pro ${term}…`);
    setStatus('Hledám evidované pobočky…');
    try {
      const branches = await api.searchBranchesByPlace(term);
      await evaluate(branches, { place: term });
    } catch (error) {
      setSaving('—');
      setResultMessage(error.message || 'Pobočky se nepodařilo načíst.');
      document.getElementById('slLiveDeals').hidden = true;
      setStatus(error.message || 'Pobočky se nepodařilo načíst.', 'bad');
    }
  }

  function bind() {
    const panel = document.querySelector('.heroNearbyPanel');
    if (!panel || panel.dataset.liveBound === '1') return;
    panel.dataset.liveBound = '1';
    resetLocateButton();
    document.getElementById('slLiveLocate')?.addEventListener('click', usePosition);
    document.getElementById('slLiveManual')?.addEventListener('submit', useManual);
    document.getElementById('slLiveClose')?.addEventListener('click', () => {
      showResult(false);
      setStatus('Výsledek je skrytý. Nové hledání ho znovu zobrazí.');
    });
    document.getElementById('slLiveRadius')?.addEventListener('change', () => {
      if (lastContext?.position) usePosition();
    });
    document.getElementById('slLivePlace')?.addEventListener('input', (event) => {
      const value = event.target.value.trim();
      if (!value || (lastContext?.place && value !== lastContext.place)) {
        showResult(false);
        lastContext = null;
        setStatus('Výsledek se zobrazí až po vyhledání.');
      }
    });
  }

  function init() {
    window.addEventListener('pageshow', resetLocateButton);
    if (!loc()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (loc()) {
          clearInterval(timer);
          createUi();
        } else if (attempts >= 50) {
          clearInterval(timer);
          resetLocateButton();
          console.warn('SLEVAO LIVE: geolokační vrstva nebyla načtena.');
        }
      }, 100);
      return;
    }
    createUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
