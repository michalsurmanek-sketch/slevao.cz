(() => {
  'use strict';

  if (!/\/(?:index\.html)?$/i.test(location.pathname)) return;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FAVORITES_KEY = 'slevao-favorite-products-v1';
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!db) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
    : '–';
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let offerMap = new Map();
  let productMap = new Map();
  let refreshToken = 0;

  function localFavoriteIds() {
    try {
      const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async function allFavoriteIds() {
    const ids = new Set(localFavoriteIds());
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      const { data, error } = await db.from('product_favorites')
        .select('product_id')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error) (data || []).forEach((row) => ids.add(String(row.product_id)));
    }
    return [...ids].slice(0, 12);
  }

  function ensureStyles() {
    if (document.querySelector('link[href*="home-personal-deals.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/home-personal-deals.css?v=20260804-1';
    document.head.appendChild(link);
  }

  function ensureSection() {
    let section = document.getElementById('myDealsSection');
    if (section) return section;
    const categories = document.getElementById('categoriesSection');
    if (!categories) return null;
    section = document.createElement('section');
    section.id = 'myDealsSection';
    section.className = 'section homePersonalDeals';
    section.innerHTML = `
      <div class="container">
        <div class="myDealsBox">
          <div class="sectionHead inlineHead myDealsHead">
            <div><span class="eyebrow">Jen pro tebe</span><h2>Moje slevy</h2><p>Aktuální a brzy začínající ceny produktů, které sis uložil do oblíbených.</p></div>
            <a class="textButton" href="ucet.html">Všechny oblíbené</a>
          </div>
          <div id="myDealsGrid" class="myDealsGrid"><div class="myDealsLoading">Načítám tvoje produkty…</div></div>
        </div>
      </div>`;
    categories.parentNode.insertBefore(section, categories);
    return section;
  }

  function removeSection() {
    document.getElementById('myDealsSection')?.remove();
  }

  function bestOffer(productId) {
    const rows = offerMap.get(String(productId)) || [];
    const current = rows.filter((row) => String(row.valid_from || '') <= today);
    return (current.length ? current : rows).slice().sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
  }

  function card(product) {
    const offer = bestOffer(product.id);
    const upcoming = offer && String(offer.valid_from || '') > today;
    const image = product.image_url
      ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">`
      : '<span class="myDealsNoImage" aria-hidden="true">%</span>';
    return `<article class="myDealCard" data-product-id="${esc(product.id)}">
      <a class="myDealImage" href="produkt.html?id=${encodeURIComponent(product.id)}">${image}</a>
      <div class="myDealBody">
        <div class="myDealTop"><span>${upcoming ? `Od ${formatDate(offer.valid_from)}` : offer ? 'Platí dnes' : 'Čeká na akci'}</span><button type="button" class="myDealHeart is-favorite" data-favorite-product="${esc(product.id)}" aria-label="Odebrat z oblíbených">♥</button></div>
        <h3><a href="produkt.html?id=${encodeURIComponent(product.id)}">${esc(product.name)}</a></h3>
        <p>${esc([product.brand, product.quantity_text].filter(Boolean).join(' · ') || 'Sjednocený produkt')}</p>
        <div class="myDealPriceRow"><div><strong>${offer ? `${money(offer.price)} Kč` : 'Bez nabídky'}</strong><small>${esc(offer?.stores?.name || 'Budeme dál hlídat')}</small></div>${offer?.old_price && Number(offer.old_price) > Number(offer.price) ? `<del>${money(offer.old_price)} Kč</del>` : ''}</div>
        <div class="myDealActions"><a href="produkt.html?id=${encodeURIComponent(product.id)}">Porovnat ceny</a>${offer ? `<button type="button" data-my-deal-add="${esc(offer.id)}">Do seznamu</button>` : ''}</div>
      </div>
    </article>`;
  }

  async function refresh() {
    const token = ++refreshToken;
    const ids = await allFavoriteIds();
    if (token !== refreshToken) return;
    if (!ids.length) {
      removeSection();
      return;
    }

    ensureStyles();
    const section = ensureSection();
    if (!section) return;
    const grid = document.getElementById('myDealsGrid');
    grid.innerHTML = '<div class="myDealsLoading">Porovnávám ceny oblíbených produktů…</div>';

    const [productsResult, offersResult] = await Promise.all([
      db.from('products').select('id,name,brand,quantity_text,image_url').in('id', ids).limit(100),
      db.from('offers')
        .select('id,product_id,price,old_price,valid_from,valid_to,stores(id,name,slug)')
        .in('product_id', ids)
        .eq('status', 'published')
        .gte('valid_to', today)
        .lte('valid_from', upcomingTo)
        .limit(1000)
    ]);
    if (token !== refreshToken) return;
    if (productsResult.error) throw productsResult.error;
    if (offersResult.error) throw offersResult.error;

    productMap = new Map((productsResult.data || []).map((row) => [String(row.id), row]));
    offerMap = new Map();
    (offersResult.data || []).forEach((offer) => {
      const rows = offerMap.get(String(offer.product_id)) || [];
      rows.push(offer);
      offerMap.set(String(offer.product_id), rows);
    });

    const products = ids.map((id) => productMap.get(String(id))).filter(Boolean);
    products.sort((a, b) => {
      const offerA = bestOffer(a.id);
      const offerB = bestOffer(b.id);
      return Number(!offerA) - Number(!offerB) || Number(offerA?.price ?? Infinity) - Number(offerB?.price ?? Infinity);
    });
    grid.innerHTML = products.length
      ? products.map(card).join('')
      : '<div class="myDealsLoading">Oblíbené produkty se nepodařilo propojit s katalogem.</div>';
  }

  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-my-deal-add]');
    if (add) {
      const offer = [...offerMap.values()].flat().find((row) => String(row.id) === add.dataset.myDealAdd);
      const product = productMap.get(String(offer?.product_id));
      if (offer && product) {
        window.SlevaoPublic?.addItemFromOffer({ ...offer, products: product });
        window.SlevaoPublic?.toast('Produkt byl přidán do nákupního seznamu.');
      }
    }
    if (event.target.closest('[data-favorite-product]')) {
      window.setTimeout(() => refresh().catch(() => {}), 450);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === FAVORITES_KEY) refresh().catch(() => {});
  });
  db.auth.onAuthStateChange(() => window.setTimeout(() => refresh().catch(() => {}), 0));
  window.setInterval(() => refresh().catch(() => {}), 5 * 60 * 1000);

  refresh().catch(() => removeSection());
  window.SlevaoMyDeals = { refresh };
})();