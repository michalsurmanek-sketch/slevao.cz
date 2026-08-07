(() => {
  'use strict';

  const PLACE_KEY = 'slevao-live-place-v1';
  let lastContext = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function loc() {
    return window.SlevaoLocation || null;
  }

  function createUi() {
    if (document.getElementById('slevaoLive')) return true;
    const categories = document.getElementById('categoriesSection');
    if (!categories) return false;
    const section = document.createElement('section');
    section.id = 'slevaoLive';
    section.className = 'slLiveSection';
    section.innerHTML = `
      <div class="container">
        <div class="slLiveCard">
          <div class="slLiveMain">
            <div class="slLiveTopline"><span class="slLiveBadge"><i class="slLiveDot"></i>SLEVAO LIVE</span></div>
            <h2>Co se vyplatí právě kolem vás</h2>
            <p class="slLiveLead">Spojí váš nákupní seznam s reálně evidovanými pobočkami a dnešními cenami. Bez polohy funguje i ruční město nebo PSČ.</p>
            <div class="slLiveMetric"><small>TEĎ KOLEM VÁS UŠETŘÍTE AŽ</small><strong id="slLiveSaving">—</strong></div>
            <div id="slLiveContext" class="slLiveContext"><span>Povolte polohu nebo zadejte město. Dokud nejsou nalezené skutečné pobočky, Slevao žádnou částku nevymýšlí.</span></div>
            <div id="slLiveStores" class="slLiveStores"></div>
          </div>
          <aside class="slLivePanel">
            <h3>Najít obchody poblíž</h3>
            <p>Poloha se vyžádá až po kliknutí. Pokud ji nepovolíte, použijte město nebo PSČ.</p>
            <div class="slLiveOptions">
              <label>Okruh<select id="slLiveRadius" class="slLiveRadius"><option value="5">5 km</option><option value="10">10 km</option><option value="15" selected>15 km</option><option value="25">25 km</option><option value="40">40 km</option></select></label>
              <button id="slLiveLocate" class="slLiveLocationButton" type="button">Použít moji polohu</button>
            </div>
            <div class="slLiveDivider">nebo ručně</div>
            <form id="slLiveManual" class="slLiveManual"><input id="slLivePlace" type="text" autocomplete="postal-code" placeholder="Město nebo PSČ"><button type="submit">Najít</button></form>
            <div id="slLiveStatus" class="slLiveStatus" role="status" aria-live="polite">Čekám na výběr polohy.</div>
            <a class="slLiveLink" href="seznam.html">Otevřít nákupní seznam →</a>
          </aside>
        </div>
      </div>`;
    categories.parentNode.insertBefore(section, categories);
    bind();
    const saved = localStorage.getItem(PLACE_KEY) || '';
    if (saved) document.getElementById('slLivePlace').value = saved;
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
    const stores = api.uniqueStores(branches).slice(0, 8);
    const node = document.getElementById('slLiveStores');
    node.innerHTML = stores.map((branch) => {
      const distance = hasDistances && Number.isFinite(Number(branch.distance_km)) ? ` · ${Number(branch.distance_km).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km` : '';
      return `<span class="slLiveStoreTag">${esc(branch.stores?.name || branch.name || 'Obchod')}${esc(distance)}</span>`;
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

  async function evaluate(branches, context = {}) {
    const api = loc();
    const unique = api.uniqueStores(branches);
    renderStoreTags(branches, Boolean(context.position));
    lastContext = { branches, ...context };

    if (!unique.length) {
      document.getElementById('slLiveSaving').textContent = '—';
      document.getElementById('slLiveContext').innerHTML = '<span>V této oblasti zatím nemáme žádnou spolehlivě evidovanou pobočku.</span>';
      setStatus('Pobočky pro tuto oblast zatím chybí. Zkuste větší okruh nebo jiné město.', 'bad');
      return;
    }

    const list = api.readList();
    const linked = list.filter((row) => !row.completed && row.product_id);
    const current = currentStoreMessage(branches, context.position);
    const lines = [];
    if (current?.text) lines.push(`<strong>${esc(current.text)}</strong>`);
    lines.push(`${unique.length} ${unique.length === 1 ? 'řetězec' : unique.length < 5 ? 'řetězce' : 'řetězců'} v zadaném okolí.`);

    if (!linked.length) {
      document.getElementById('slLiveSaving').textContent = '—';
      lines.push('V nákupním seznamu zatím nejsou propojené produkty, takže úsporu nelze korektně spočítat.');
      document.getElementById('slLiveContext').innerHTML = lines.map((line) => `<span>${line}</span>`).join('');
      setStatus(`Nalezeno ${unique.length} obchodních řetězců. Přidejte produkty do seznamu pro výpočet úspory.`, 'good');
      return;
    }

    const storeIds = unique.map((branch) => branch.store_id);
    const offers = await api.fetchOffersForList(linked, storeIds, branches);
    const metrics = api.basketMetrics(linked, offers);
    document.getElementById('slLiveSaving').textContent = metrics.matchedCount ? `${api.money(metrics.savings)} Kč` : '—';
    lines.push(`Cenu se podařilo najít pro ${metrics.matchedCount} z ${metrics.itemCount} propojených položek.`);
    if (metrics.bestSingleStore) lines.push(`Nejvýhodnější jeden obchod pro celý porovnatelný nákup: <strong>${esc(metrics.bestSingleStore.store_name)} · ${api.money(metrics.bestSingleStore.total)} Kč</strong>.`);
    const cheaper = cheaperElsewhereText(current?.branch, branches, metrics, offers);
    if (cheaper) lines.push(esc(cheaper));
    document.getElementById('slLiveContext').innerHTML = lines.map((line) => `<span>${line}</span>`).join('');
    setStatus(metrics.matchedCount ? 'SLEVAO LIVE počítá z dnešních cen a skutečně evidovaných poboček.' : 'V okolních řetězcích nejsou pro položky ze seznamu dohledané dnešní ceny.', metrics.matchedCount ? 'good' : '');
  }

  async function usePosition() {
    const api = loc();
    const button = document.getElementById('slLiveLocate');
    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Určuji polohu…';
    setStatus('Zjišťuji polohu a hledám skutečné pobočky…');
    try {
      const position = await api.getPosition();
      const radius = Number(document.getElementById('slLiveRadius').value || 15);
      const branches = await api.fetchNearbyBranches(position.latitude, position.longitude, radius);
      await evaluate(branches, { position, radius });
    } catch (error) {
      setStatus(error.message || 'Polohu se nepodařilo použít. Zadejte město nebo PSČ.', 'bad');
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  async function useManual(event) {
    event.preventDefault();
    const api = loc();
    const input = document.getElementById('slLivePlace');
    const term = input.value.trim();
    if (!term) { input.focus(); return; }
    localStorage.setItem(PLACE_KEY, term);
    setStatus('Hledám evidované pobočky…');
    try {
      const branches = await api.searchBranchesByPlace(term);
      await evaluate(branches, { place: term });
    } catch (error) {
      setStatus(error.message || 'Pobočky se nepodařilo načíst.', 'bad');
    }
  }

  function bind() {
    document.getElementById('slLiveLocate').addEventListener('click', usePosition);
    document.getElementById('slLiveManual').addEventListener('submit', useManual);
    document.getElementById('slLiveRadius').addEventListener('change', () => {
      if (lastContext?.position) usePosition();
    });
  }

  function init() {
    if (!loc()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (loc()) {
          clearInterval(timer);
          createUi();
        } else if (attempts >= 50) {
          clearInterval(timer);
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
