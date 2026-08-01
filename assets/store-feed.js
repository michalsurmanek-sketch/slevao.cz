(() => {
  const config = window.SLEVAO_STORE || {};
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FAVORITES_KEY = 'slevao-favorite-offers-v1';
  const OFFICIAL_TESCO_LEAFLETS = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const price = (offer) => Number(offer.price || 0);
  const old = (offer) => Number(offer.old_price || 0);
  const saving = (offer) => Math.max(0, old(offer) - price(offer));
  const discount = (offer) => old(offer) > price(offer) ? Math.round(saving(offer) / old(offer) * 100) : 0;
  const format = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : '';
  const formatLong = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : '';

  let offers = [];
  let visible = 24;
  let store = null;
  let loading = false;
  let activeCategory = 'all';
  let showSaved = false;
  let favorites = readFavorites();

  function readFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); } catch { /* Storage can be disabled. */ }
  }

  const request = async (table, params) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`, {
        headers: { apikey: KEY },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Databáze odpověděla chybou ${response.status}.`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const unique = (rows) => [...new Map(rows.map((offer) => [
    [fold(offer.title), offer.valid_from, offer.valid_to].join('|'), offer,
  ])).values()];

  function searchableText(offer) {
    const productName = Array.isArray(offer.products) ? offer.products[0]?.name : offer.products?.name;
    return fold([offer.title, productName].join(' '));
  }

  function categoryFor(offer) {
    const text = searchableText(offer);
    if (/(pes|kock|granul|konzerv.*zvir|mazlic|steliv|whiskas|pedigree|purina)/.test(text)) return 'pets';
    if (/(napoj|voda|pivo|vino|dzus|juice|cola|limonad|sirup|kava|caj|energy)/.test(text)) return 'drinks';
    if (/(praci|avivaz|sampon|sprch|mydlo|zubni|drogeri|toalet|kosmetik|deodor|cistic|tablety do mycky)/.test(text)) return 'drugstore';
    if (/(domac|nadobi|hrnec|panev|rucnik|povlec|baterie|zarov|papirnict|zahrad|naradi)/.test(text)) return 'home';
    return 'food';
  }

  function updateFavoriteControls() {
    if ($('savedCount')) $('savedCount').textContent = favorites.size.toLocaleString('cs-CZ');
    if ($('savedToggle')) {
      $('savedToggle').classList.toggle('active', showSaved);
      $('savedToggle').setAttribute('aria-pressed', String(showSaved));
    }
  }

  function renderHeroProducts(rows) {
    const target = $('heroProducts');
    if (!target) return;
    const imageOffers = rows.filter((offer) => offer.image_url).slice(0, 3);
    target.querySelectorAll('.heroProduct').forEach((slot, index) => {
      const offer = imageOffers[index];
      slot.innerHTML = offer
        ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.title)}" loading="eager" onerror="this.closest('.heroProduct').hidden=true">`
        : '';
      slot.hidden = !offer;
    });
  }

  function leafletCard(leaflet) {
    const url = /^https:\/\//.test(String(leaflet.url || '')) ? leaflet.url : OFFICIAL_TESCO_LEAFLETS;
    const validity = leaflet.valid_from && leaflet.valid_to
      ? `${formatLong(leaflet.valid_from)} – ${formatLong(leaflet.valid_to)}`
      : 'Aktuální platnost ověříš po otevření';
    return `<a class="leafletCard" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      <div class="leafletCover">
        <img src="assets/logos/tesco.svg" alt="" aria-hidden="true">
        <span>${esc(leaflet.subtitle || 'Tesco')}</span>
      </div>
      <div class="leafletBody">
        <span class="leafletType">${leaflet.key === 'catalog' ? 'Katalog' : 'Akční leták'}</span>
        <h3>${esc(leaflet.subtitle || leaflet.title || 'Tesco leták')}</h3>
        <p>${esc(leaflet.title || 'Aktuální nabídka')}</p>
        <div class="leafletValidity">Platí ${esc(validity)}</div>
        <span class="leafletAction">${leaflet.direct ? 'Otevřít leták' : 'Prohlédnout na iTesco'}</span>
      </div>
    </a>`;
  }

  async function loadLeaflets() {
    const target = $('leafletGrid');
    if (!target) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/store-leaflet-feed`, {
        headers: { apikey: KEY },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!Array.isArray(result.leaflets) || !result.leaflets.length) throw new Error('Bez aktuálních letáků');
      target.innerHTML = result.leaflets.slice(0, 3).map(leafletCard).join('');
    } catch {
      target.innerHTML = `<a class="leafletCard" href="${OFFICIAL_TESCO_LEAFLETS}" target="_blank" rel="noopener noreferrer">
        <div class="leafletCover"><img src="assets/logos/tesco.svg" alt="" aria-hidden="true"><span>Aktuální letáky</span></div>
        <div class="leafletBody"><span class="leafletType">Oficiální zdroj</span><h3>Letáky a katalogy Tesco</h3><p>Prohlédni si právě platnou nabídku podle své prodejny.</p><span class="leafletAction">Otevřít iTesco</span></div>
      </a>`;
    } finally {
      clearTimeout(timer);
    }
  }

  function filteredOffers() {
    const query = fold($('q').value);
    const sort = $('sort').value;
    const rows = offers.filter((offer) => {
      if (query && !searchableText(offer).includes(query)) return false;
      if (activeCategory !== 'all' && categoryFor(offer) !== activeCategory) return false;
      return !showSaved || favorites.has(String(offer.id));
    });
    rows.sort((a, b) => sort === 'discount' ? discount(b) - discount(a)
      : sort === 'saving' ? saving(b) - saving(a)
        : sort === 'price' ? price(a) - price(b)
          : sort === 'name' ? String(a.title).localeCompare(String(b.title), 'cs')
            : 0);
    return rows;
  }

  function offerCard(offer) {
    const id = String(offer.id);
    const isFavorite = favorites.has(id);
    return `<article class="deal">
      <div class="media">
        ${offer.image_url ? `<img src="${esc(offer.image_url)}" alt="${esc(offer.title)}" loading="lazy" onerror="this.remove()">` : '🏷️'}
        ${discount(offer) ? `<span class="discount">−${discount(offer)} %</span>` : ''}
        ${$('savedToggle') ? `<button class="favorite${isFavorite ? ' active' : ''}" type="button" data-favorite="${esc(id)}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Odebrat z uložených' : 'Uložit nabídku'}">${isFavorite ? '♥' : '♡'}</button>` : ''}
      </div>
      <div class="body">
        <div class="storeName">${esc(store?.name || config.name)}</div>
        <h3>${esc(offer.title)}</h3>
        <div class="prices"><span class="price">${price(offer).toLocaleString('cs-CZ')} Kč</span>${old(offer) ? `<span class="old">${old(offer).toLocaleString('cs-CZ')} Kč</span>` : ''}</div>
        ${saving(offer) ? `<span class="saving">Ušetříš ${saving(offer).toLocaleString('cs-CZ')} Kč</span>` : ''}
        <div class="validity">Platí ${format(offer.valid_from)}–${format(offer.valid_to)}</div>
      </div>
    </article>`;
  }

  function render() {
    const rows = filteredOffers();
    $('resultCount').textContent = showSaved
      ? `${rows.length} uložených nabídek`
      : `${rows.length} aktuálních nabídek`;
    $('grid').innerHTML = rows.length
      ? rows.slice(0, visible).map(offerCard).join('')
      : `<div class="empty"><strong>${showSaved ? 'Zatím nemáš uložené žádné nabídky' : 'Aktuálně tu nejsou žádné odpovídající nabídky'}</strong>${showSaved ? 'Ulož si produkt klepnutím na srdíčko.' : 'Zkus jinou kategorii nebo zruš hledání.'}</div>`;
    $('loadMore').hidden = rows.length <= visible;
    $('grid').querySelectorAll('[data-favorite]').forEach((button) => button.addEventListener('click', () => {
      const id = String(button.dataset.favorite);
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      saveFavorites();
      updateFavoriteControls();
      render();
    }));
  }

  function apply(storeData, rows, status) {
    store = storeData;
    offers = unique(rows);
    document.documentElement.style.setProperty('--store', config.color || store.primary_color || '#0b6f68');
    $('titleName').textContent = store.name;
    $('status').textContent = status;
    $('offerCount').textContent = `${offers.length} nabídek`;
    $('updated').textContent = `Aktualizováno ${new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
    if ($('storeLogo')) {
      const logo = config.logo || store.logo_url;
      if (logo) { $('storeLogo').src = logo; $('storeLogo').hidden = false; } else $('storeLogo').hidden = true;
    }
    renderHeroProducts(offers);
    updateFavoriteControls();
    render();
  }

  async function load() {
    if (loading) return;
    loading = true;
    $('status').textContent = 'Načítám aktuální leták…';
    try {
      const stores = await request('stores', {
        select: 'id,name,slug,logo_url,primary_color', slug: `eq.${config.slug}`, limit: '1',
      });
      if (!stores[0]) throw new Error('Obchod není v databázi aktivní.');
      const today = new Date().toISOString().slice(0, 10);
      const rows = await request('offers', {
        select: 'id,title,price,old_price,image_url,valid_from,valid_to,products(name)',
        store_id: `eq.${stores[0].id}`,
        status: 'eq.published',
        valid_from:`lte.${today}`,
        valid_to:`gte.${today}`,
        order: 'published_at.desc',
      });
      apply(stores[0], rows, '● Živý feed');
    } catch (error) {
      $('status').textContent = 'Feed není dostupný';
      $('grid').innerHTML = `<div class="error"><strong>Nabídky se nepodařilo načíst</strong>${esc(error?.message || 'Zkus stránku obnovit.')}<br><button class="retry" id="retry">Zkusit znovu</button></div>`;
      $('retry')?.addEventListener('click', load);
    } finally {
      loading = false;
    }
  }

  $('q').addEventListener('input', () => { visible = 24; render(); });
  $('sort').addEventListener('change', () => { visible = 24; render(); });
  $('loadMore').addEventListener('click', () => { visible += 24; render(); });
  $('categoryBar')?.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    visible = 24;
    $('categoryBar').querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));
  $('savedToggle')?.addEventListener('click', () => { showSaved = !showSaved; visible = 24; updateFavoriteControls(); render(); });
  window.addEventListener('online', load);
  load();
  loadLeaflets();
  setInterval(load,5*60*1000);
})();
