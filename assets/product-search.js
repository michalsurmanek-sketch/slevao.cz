(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const formatDate = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric' }).format(new Date(`${String(value).slice(0,10)}T12:00:00`)) : '–';
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const state = {
    query: new URLSearchParams(location.search).get('q') || '',
    filter: 'all',
    sort: 'relevance',
    products: [],
    offerMap: new Map(),
    loadingToken: 0
  };

  function message(text, bad = false) {
    $('searchMessage').textContent = text;
    $('searchMessage').style.color = bad ? '#b32631' : '';
  }

  function offerState(offer) {
    if (!offer) return 'without';
    return String(offer.valid_from || '') <= today ? 'current' : 'upcoming';
  }

  function bestOffer(productId) {
    const rows = state.offerMap.get(productId) || [];
    const current = rows.filter((row) => String(row.valid_from || '') <= today);
    return (current.length ? current : rows).slice().sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
  }

  function productOffers(productId) {
    return state.offerMap.get(productId) || [];
  }

  function cardHtml(product) {
    const offers = productOffers(product.id);
    const offer = bestOffer(product.id);
    const status = offerState(offer);
    const storeCount = new Set(offers.map((row) => row.store_id)).size;
    const image = product.image_url
      ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">`
      : '<span class="sfNoImage" aria-hidden="true">%</span>';
    const price = offer ? `${money(offer.price)} Kč` : 'Bez akční ceny';
    const storeText = offer
      ? `${esc(offer.stores?.name || 'Obchod')}${storeCount > 1 ? `<br>+ ${storeCount - 1} další` : ''}`
      : 'Momentálně bez nabídky';
    const validity = status === 'current'
      ? `Platí do ${formatDate(offer.valid_to)}`
      : status === 'upcoming'
        ? `<span class="sfUpcomingText">Začíná ${formatDate(offer.valid_from)}</span>`
        : 'Produkt je v katalogu Slevao.cz';

    return `<article class="sfCard sfProductResult" data-product-id="${esc(product.id)}">
      <a class="sfProductResultImage" href="produkt.html?id=${encodeURIComponent(product.id)}">${image}</a>
      <div>
        <h2><a href="produkt.html?id=${encodeURIComponent(product.id)}" style="color:inherit;text-decoration:none">${esc(product.name)}</a></h2>
        <div class="sfResultMeta">${esc([product.brand, product.quantity_text].filter(Boolean).join(' · ') || 'Sjednocený produkt')}</div>
        <div class="sfResultPriceRow"><div><div class="sfResultPrice">${price}</div><div class="sfResultMeta">${validity}</div></div><div class="sfResultStore">${storeText}</div></div>
        <div class="sfResultActions">
          <a class="sfButton primary" href="produkt.html?id=${encodeURIComponent(product.id)}">Detail a ceny</a>
          ${offer ? `<button class="sfButton" type="button" data-search-add="${esc(offer.id)}">Do seznamu</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function filteredProducts() {
    let rows = state.products.slice();
    if (state.filter !== 'all') {
      rows = rows.filter((product) => offerState(bestOffer(product.id)) === state.filter);
    }
    if (state.sort === 'price') {
      rows.sort((a, b) => Number(bestOffer(a.id)?.price ?? Infinity) - Number(bestOffer(b.id)?.price ?? Infinity));
    } else if (state.sort === 'stores') {
      rows.sort((a, b) => new Set(productOffers(b.id).map((row) => row.store_id)).size - new Set(productOffers(a.id).map((row) => row.store_id)).size);
    } else if (state.sort === 'name') {
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'));
    } else if (state.query) {
      rows.sort((a, b) => Number(b.relevance || 0) - Number(a.relevance || 0) || String(a.name).localeCompare(String(b.name), 'cs'));
    }
    return rows;
  }

  function render() {
    const rows = filteredProducts();
    $('resultTitle').textContent = state.query ? `Výsledky pro „${state.query}“` : 'Nejzajímavější aktuální produkty';
    message(`${rows.length} produktů${state.filter !== 'all' ? ' v tomto filtru' : ''}.`);
    $('results').innerHTML = rows.length
      ? rows.map(cardHtml).join('')
      : '<div class="sfEmpty" style="grid-column:1/-1">Pro tento dotaz a filtr jsme nic nenašli. Zkus kratší nebo obecnější název produktu.</div>';
  }

  async function fetchOffers(productIds) {
    if (!productIds.length) return [];
    const all = [];
    for (let index = 0; index < productIds.length; index += 120) {
      const chunk = productIds.slice(index, index + 120);
      const { data, error } = await db.from('offers')
        .select('id,product_id,store_id,title,price,old_price,image_url,valid_from,valid_to,stores(id,name,slug)')
        .in('product_id', chunk)
        .eq('status', 'published')
        .gte('valid_to', today)
        .lte('valid_from', upcomingTo)
        .limit(4000);
      if (error) throw error;
      all.push(...(data || []));
    }
    return all;
  }

  async function loadDefault(token) {
    const { data, error } = await db.from('offers')
      .select('id,product_id,store_id,title,price,old_price,image_url,valid_from,valid_to,stores(id,name,slug),products(id,name,brand,quantity_text,image_url,slug)')
      .eq('status', 'published')
      .not('product_id', 'is', null)
      .gte('valid_to', today)
      .lte('valid_from', upcomingTo)
      .order('price', { ascending: true })
      .limit(300);
    if (error) throw error;
    if (token !== state.loadingToken) return;

    const products = new Map();
    const offers = [];
    (data || []).forEach((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      if (!product?.id) return;
      products.set(product.id, product);
      offers.push({ ...row, products: undefined });
    });
    state.products = [...products.values()].slice(0, 90);
    setOffers(offers.filter((row) => products.has(row.product_id)));
  }

  async function loadSearch(query, token) {
    const safe = query.replace(/[(),]/g, ' ').replace(/[%_*]/g, ' ').replace(/\s+/g, ' ').trim();
    const { data, error } = await db.rpc('search_products_catalog', {
      search_query: safe,
      result_limit: 120
    });
    if (error) throw error;
    if (token !== state.loadingToken) return;
    state.products = data || [];
    const offers = await fetchOffers(state.products.map((row) => row.id));
    if (token !== state.loadingToken) return;
    setOffers(offers);
  }

  function setOffers(offers) {
    state.offerMap = new Map();
    offers.forEach((offer) => {
      const rows = state.offerMap.get(offer.product_id) || [];
      rows.push(offer);
      state.offerMap.set(offer.product_id, rows);
    });
  }

  async function load() {
    const token = ++state.loadingToken;
    $('results').innerHTML = '<div class="sfLoading" style="grid-column:1/-1">Vyhledávám produkty a porovnávám ceny…</div>';
    message('');
    try {
      if (state.query.trim().length === 1) {
        state.products = [];
        setOffers([]);
        render();
        message('Napiš alespoň dva znaky.', true);
        return;
      }
      if (state.query.trim().length >= 2) await loadSearch(state.query.trim(), token);
      else await loadDefault(token);
      if (token !== state.loadingToken) return;
      render();
    } catch (error) {
      if (token !== state.loadingToken) return;
      $('results').innerHTML = '<div class="sfEmpty" style="grid-column:1/-1">Vyhledávání se nepodařilo načíst.</div>';
      message(error.message || 'Vyhledávání není momentálně dostupné.', true);
    }
  }

  function setQuery(value, push = true) {
    state.query = value.trim();
    if (push) {
      const url = new URL(location.href);
      if (state.query) url.searchParams.set('q', state.query); else url.searchParams.delete('q');
      history.replaceState({}, '', url);
    }
    document.title = state.query ? `${state.query} – porovnání cen | Slevao.cz` : 'Vyhledávání produktů a cen | Slevao.cz';
    load();
  }

  $('searchInput').value = state.query;
  $('searchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    setQuery($('searchInput').value);
  });

  let inputTimer = 0;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => setQuery($('searchInput').value), 380);
  });

  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));

  $('sort').addEventListener('change', () => {
    state.sort = $('sort').value;
    render();
  });

  $('results').addEventListener('click', (event) => {
    const button = event.target.closest('[data-search-add]');
    if (!button) return;
    const offerId = button.dataset.searchAdd;
    const offer = [...state.offerMap.values()].flat().find((row) => row.id === offerId);
    const product = state.products.find((row) => row.id === offer?.product_id);
    if (!offer || !product) return;
    window.SlevaoPublic?.addItemFromOffer({ ...offer, products: product });
    window.SlevaoPublic?.toast('Produkt byl přidán do nákupního seznamu.');
  });

  load();
})();
