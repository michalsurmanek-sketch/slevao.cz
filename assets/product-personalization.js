(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FAVORITES_KEY = 'slevao-favorite-products-v1';
  const RECENT_KEY = 'slevao-recent-products-v1';
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!db) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  let session = null;
  let favoriteIds = readFavoriteIds();
  let recentRows = readRecentRows();
  let accountProducts = new Map();
  let accountOffers = new Map();
  let observerQueued = false;

  function safeJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function readFavoriteIds() {
    const rows = safeJson(FAVORITES_KEY, []);
    return new Set(Array.isArray(rows) ? rows.map(String).filter(Boolean) : []);
  }

  function saveFavoriteIds() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds])); } catch {}
  }

  function readRecentRows() {
    const rows = safeJson(RECENT_KEY, []);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => typeof row === 'string' ? { id:row, viewed_at:new Date().toISOString() } : row)
      .filter((row) => row?.id)
      .slice(0, 30);
  }

  function saveRecentRows() {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentRows.slice(0, 30))); } catch {}
  }

  function toast(text) {
    if (window.SlevaoPublic?.toast) window.SlevaoPublic.toast(text);
    else {
      let node = document.querySelector('.sfPersonalToast');
      if (!node) {
        node = document.createElement('div');
        node.className = 'sfPersonalToast';
        document.body.appendChild(node);
      }
      node.textContent = text;
      node.classList.add('show');
      clearTimeout(node._timer);
      node._timer = setTimeout(() => node.classList.remove('show'), 2600);
    }
  }

  function productIdFromUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!/produkt\.html$/i.test(url.pathname)) return '';
      return url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function detailProductId() {
    return /produkt\.html$/i.test(location.pathname)
      ? new URLSearchParams(location.search).get('id') || ''
      : '';
  }

  function isFavorite(productId) {
    return favoriteIds.has(String(productId || ''));
  }

  function buttonLabel(productId) {
    return isFavorite(productId) ? '♥ Oblíbené' : '♡ Oblíbit';
  }

  function updateFavoriteButtons() {
    document.querySelectorAll('[data-favorite-product]').forEach((button) => {
      const productId = button.dataset.favoriteProduct;
      const active = isFavorite(productId);
      const pressed = String(active);
      const label = buttonLabel(productId);
      const title = active ? 'Odebrat produkt z oblíbených' : 'Uložit produkt do oblíbených';
      button.classList.toggle('is-favorite', active);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      if (button.textContent !== label) button.textContent = label;
      if (button.title !== title) button.title = title;
    });
  }

  function addFavoriteButton(container, productId, className = 'sfButton') {
    if (!container || !productId || container.querySelector(`[data-favorite-product="${CSS.escape(productId)}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${className} sfFavoriteButton`;
    button.dataset.favoriteProduct = productId;
    container.appendChild(button);
  }

  function enhanceCards() {
    document.querySelectorAll('[data-product-id]').forEach((card) => {
      const productId = card.dataset.productId;
      const actions = card.querySelector('.sfResultActions,.slevaoExtraActions,.sfOfferActions,.dealActions,.actions');
      addFavoriteButton(actions, productId);
    });

    document.querySelectorAll('a[href*="produkt.html?id="]').forEach((link) => {
      const productId = productIdFromUrl(link.href);
      const card = link.closest('article,.dealCard,.offerCard,.productCard,.sfCard');
      const actions = card?.querySelector('.slevaoExtraActions,.sfResultActions,.sfOfferActions,.dealActions,.actions');
      addFavoriteButton(actions, productId);
    });

    const currentId = detailProductId();
    if (currentId) {
      const hero = document.querySelector('.sfHeroMain');
      if (hero) {
        let actions = hero.querySelector('.sfPersonalHeroActions');
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'sfPersonalHeroActions';
          hero.appendChild(actions);
          addFavoriteButton(actions, currentId, 'sfButton');
          const searchLink = document.createElement('a');
          searchLink.className = 'sfButton sfFindSimilarLink';
          searchLink.textContent = 'Najít podobné';
          actions.appendChild(searchLink);
        }
        const searchLink = actions.querySelector('.sfFindSimilarLink') || actions.querySelector('a.sfButton');
        const productName = document.getElementById('productName')?.textContent?.trim() || '';
        if (searchLink && productName && !/^Načítám/i.test(productName)) {
          const href = `index.html?q=${encodeURIComponent(productName)}#dealsSection`;
          if (searchLink.getAttribute('href') !== href) searchLink.setAttribute('href', href);
        }
      }
    }

    updateFavoriteButtons();
  }

  function queueEnhance() {
    if (observerQueued) return;
    observerQueued = true;
    requestAnimationFrame(() => {
      observerQueued = false;
      enhanceCards();
    });
  }

  async function loadServerFavorites() {
    if (!session) return;
    const { data, error } = await db.from('product_favorites')
      .select('product_id')
      .eq('user_id', session.user.id)
      .limit(5000);
    if (error) throw error;
    (data || []).forEach((row) => favoriteIds.add(String(row.product_id)));
    saveFavoriteIds();
  }

  async function syncLocalFavorites() {
    if (!session || !favoriteIds.size) return;
    const rows = [...favoriteIds].map((productId) => ({ user_id:session.user.id, product_id:productId }));
    for (let index = 0; index < rows.length; index += 300) {
      const { error } = await db.from('product_favorites')
        .upsert(rows.slice(index, index + 300), { onConflict:'user_id,product_id', ignoreDuplicates:true });
      if (error) throw error;
    }
  }

  async function syncRecentRows() {
    if (!session || !recentRows.length) return;
    const rows = recentRows.slice(0, 30).map((row) => ({
      user_id:session.user.id,
      product_id:String(row.id),
      last_viewed_at:row.viewed_at || new Date().toISOString(),
      view_count:Math.max(1, Number(row.view_count || 1))
    }));
    const { error } = await db.from('recently_viewed_products')
      .upsert(rows, { onConflict:'user_id,product_id' });
    if (error) throw error;
  }

  async function toggleFavorite(productId) {
    productId = String(productId || '');
    if (!productId) return;
    const removing = favoriteIds.has(productId);
    if (removing) favoriteIds.delete(productId); else favoriteIds.add(productId);
    saveFavoriteIds();
    updateFavoriteButtons();

    try {
      if (session) {
        if (removing) {
          const { error } = await db.from('product_favorites')
            .delete().eq('user_id', session.user.id).eq('product_id', productId);
          if (error) throw error;
        } else {
          const { error } = await db.from('product_favorites')
            .upsert({ user_id:session.user.id, product_id:productId }, { onConflict:'user_id,product_id' });
          if (error) throw error;
        }
      }
      toast(removing ? 'Produkt byl odebrán z oblíbených.' : 'Produkt je uložený v oblíbených.');
      renderAccountDashboard();
    } catch (error) {
      if (removing) favoriteIds.add(productId); else favoriteIds.delete(productId);
      saveFavoriteIds();
      updateFavoriteButtons();
      toast(error.message || 'Oblíbené se nepodařilo uložit.');
    }
  }

  async function recordRecentView(productId) {
    productId = String(productId || '');
    if (!productId) return;
    const now = new Date().toISOString();
    const existing = recentRows.find((row) => String(row.id) === productId);
    recentRows = [
      { id:productId, viewed_at:now, view_count:Number(existing?.view_count || 0) + 1 },
      ...recentRows.filter((row) => String(row.id) !== productId)
    ].slice(0, 30);
    saveRecentRows();

    if (session) {
      const { data } = await db.from('recently_viewed_products')
        .select('view_count').eq('user_id', session.user.id).eq('product_id', productId).maybeSingle();
      await db.from('recently_viewed_products').upsert({
        user_id:session.user.id,
        product_id:productId,
        last_viewed_at:now,
        view_count:Number(data?.view_count || 0) + 1
      }, { onConflict:'user_id,product_id' });
    }
  }

  function bestOffer(productId) {
    const rows = accountOffers.get(productId) || [];
    const current = rows.filter((row) => String(row.valid_from || '') <= today);
    return (current.length ? current : rows).slice().sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
  }

  function personalCard(product, mode = 'favorite') {
    const offer = bestOffer(product.id);
    const image = product.image_url
      ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">`
      : '<span class="sfNoImage" aria-hidden="true">%</span>';
    const price = offer ? `${money(offer.price)} Kč` : 'Bez aktuální akce';
    const store = offer?.stores?.name || 'Sleduj další letáky';
    return `<article class="sfPersonalProduct" data-product-id="${esc(product.id)}">
      <a class="sfPersonalProductImage" href="produkt.html?id=${encodeURIComponent(product.id)}">${image}</a>
      <div class="sfPersonalProductBody">
        <h3><a href="produkt.html?id=${encodeURIComponent(product.id)}">${esc(product.name)}</a></h3>
        <p>${esc([product.brand, product.quantity_text].filter(Boolean).join(' · ') || 'Sjednocený produkt')}</p>
        <strong>${price}</strong><small>${esc(store)}</small>
        <div class="sfPersonalProductActions">
          <a class="sfButton primary" href="produkt.html?id=${encodeURIComponent(product.id)}">Detail</a>
          ${offer ? `<button class="sfButton" type="button" data-personal-add="${esc(offer.id)}">Do seznamu</button>` : ''}
          ${mode === 'favorite' ? `<button class="sfButton sfFavoriteButton is-favorite" type="button" data-favorite-product="${esc(product.id)}">♥ Oblíbené</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  async function fetchPersonalProducts(ids) {
    if (!ids.length) return { products:[], offers:[] };
    const [{ data:products, error:productError }, { data:offers, error:offerError }] = await Promise.all([
      db.from('products').select('id,name,brand,quantity_text,image_url,slug').in('id', ids).limit(500),
      db.from('offers').select('id,product_id,store_id,price,old_price,valid_from,valid_to,stores(id,name,slug)')
        .in('product_id', ids).eq('status','published').gte('valid_to', today).lte('valid_from', upcomingTo).limit(3000)
    ]);
    if (productError) throw productError;
    if (offerError) throw offerError;
    return { products:products || [], offers:offers || [] };
  }

  async function serverRecentIds() {
    if (!session) return recentRows.map((row) => String(row.id));
    const { data, error } = await db.from('recently_viewed_products')
      .select('product_id,last_viewed_at')
      .eq('user_id', session.user.id)
      .order('last_viewed_at', { ascending:false })
      .limit(20);
    if (error) throw error;
    const ids = (data || []).map((row) => String(row.product_id));
    return [...new Set([...ids, ...recentRows.map((row) => String(row.id))])].slice(0, 20);
  }

  function ensureAccountSections() {
    const profile = document.getElementById('profileArea');
    if (!profile || document.getElementById('favoriteProducts')) return;
    const favoriteSection = document.createElement('section');
    favoriteSection.className = 'sfSection sfCard sfPanel';
    favoriteSection.innerHTML = `<div class="sfSectionHead"><div><span class="sfEyebrow">Stálé produkty</span><h2>Moje oblíbené produkty</h2><p class="sfMuted">Oblíbený produkt zůstává uložený i po skončení konkrétní nabídky.</p></div><a class="sfButton primary" href="index.html#dealsSection">Přidat produkt</a></div><div id="favoriteProducts" class="sfPersonalGrid"><div class="sfLoading">Načítám oblíbené…</div></div>`;
    profile.appendChild(favoriteSection);

    const recentSection = document.createElement('section');
    recentSection.className = 'sfSection sfCard sfPanel';
    recentSection.innerHTML = `<div class="sfSectionHead"><div><span class="sfEyebrow">Historie prohlížení</span><h2>Nedávno prohlížené</h2></div><button id="clearRecentProducts" class="sfButton" type="button">Vymazat historii</button></div><div id="recentProducts" class="sfPersonalGrid"><div class="sfLoading">Načítám historii…</div></div>`;
    profile.appendChild(recentSection);
  }

  async function renderAccountDashboard() {
    const profile = document.getElementById('profileArea');
    if (!profile || !session) return;
    ensureAccountSections();
    const favoriteContainer = document.getElementById('favoriteProducts');
    const recentContainer = document.getElementById('recentProducts');
    if (!favoriteContainer || !recentContainer) return;

    try {
      const favoriteOrder = [...favoriteIds];
      const recentOrder = await serverRecentIds();
      const allIds = [...new Set([...favoriteOrder, ...recentOrder])];
      const { products, offers } = await fetchPersonalProducts(allIds);
      accountProducts = new Map(products.map((row) => [String(row.id), row]));
      accountOffers = new Map();
      offers.forEach((offer) => {
        const rows = accountOffers.get(String(offer.product_id)) || [];
        rows.push(offer);
        accountOffers.set(String(offer.product_id), rows);
      });

      const favoriteProducts = favoriteOrder.map((id) => accountProducts.get(id)).filter(Boolean);
      const recentProducts = recentOrder.map((id) => accountProducts.get(id)).filter(Boolean).slice(0, 12);
      favoriteContainer.innerHTML = favoriteProducts.length
        ? favoriteProducts.map((row) => personalCard(row, 'favorite')).join('')
        : '<div class="sfEmpty" style="grid-column:1/-1">Zatím nemáš oblíbený produkt. Ulož si ho ve vyhledávání nebo na detailu.</div>';
      recentContainer.innerHTML = recentProducts.length
        ? recentProducts.map((row) => personalCard(row, 'recent')).join('')
        : '<div class="sfEmpty" style="grid-column:1/-1">Historie prohlížení je prázdná.</div>';
      const count = document.getElementById('accountFavoriteCount');
      if (count) count.textContent = String(favoriteProducts.length);
      updateFavoriteButtons();
    } catch (error) {
      favoriteContainer.innerHTML = `<div class="sfEmpty" style="grid-column:1/-1">${esc(error.message || 'Oblíbené se nepodařilo načíst.')}</div>`;
      recentContainer.innerHTML = '<div class="sfEmpty" style="grid-column:1/-1">Historii se nepodařilo načíst.</div>';
    }
  }

  async function clearRecent() {
    recentRows = [];
    saveRecentRows();
    if (session) await db.from('recently_viewed_products').delete().eq('user_id', session.user.id);
    renderAccountDashboard();
    toast('Historie prohlížení byla vymazána.');
  }

  async function initializeSession() {
    const { data } = await db.auth.getSession();
    session = data.session || null;
    if (session) {
      await syncLocalFavorites();
      await syncRecentRows();
      await loadServerFavorites();
    }
    updateFavoriteButtons();
    renderAccountDashboard();
  }

  document.addEventListener('click', async (event) => {
    const favorite = event.target.closest('[data-favorite-product]');
    if (favorite) {
      event.preventDefault();
      await toggleFavorite(favorite.dataset.favoriteProduct);
      return;
    }
    const add = event.target.closest('[data-personal-add]');
    if (add) {
      const offer = [...accountOffers.values()].flat().find((row) => String(row.id) === add.dataset.personalAdd);
      const product = accountProducts.get(String(offer?.product_id));
      if (offer && product) {
        window.SlevaoPublic?.addItemFromOffer({ ...offer, products:product });
        toast('Produkt byl přidán do nákupního seznamu.');
      }
      return;
    }
    if (event.target.closest('#clearRecentProducts')) await clearRecent();
  });

  db.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession || null;
    initializeSession().catch(() => {});
  });

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
      return !target?.closest?.('[data-favorite-product]');
    });
    if (relevant) queueEnhance();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  enhanceCards();

  const currentProductId = detailProductId();
  if (currentProductId) recordRecentView(currentProductId).catch(() => {});
  initializeSession().catch(() => {});

  window.SlevaoPersonalization = {
    isFavorite,
    toggleFavorite,
    recordRecentView,
    favoriteIds:() => [...favoriteIds]
  };
})();
