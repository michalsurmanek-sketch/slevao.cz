window.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const msg = (id, text, type = 'ok') => {
    const element = $(id);
    if (!element) return;
    element.textContent = text;
    element.className = `msg ${type}`;
  };
  const clearMsg = (id) => {
    const element = $(id);
    if (element) element.className = 'msg';
  };
  const slugify = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' a ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const nullable = (value) => String(value || '').trim() || null;

  if (!window.supabase) {
    msg('loginMsg', 'Nepodařilo se načíst Supabase. Obnov stránku přes Ctrl+F5.', 'err');
    return;
  }

  const db = window.supabase.createClient(
    'https://uhampjdqjxmbhaptgitn.supabase.co',
    'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU',
  );
  const roleOf = (session) => session?.user?.app_metadata?.role || '';
  let allOffers = [];
  let allStores = [];
  let slugManuallyEdited = false;

  function clearPublicCache() {
    try {
      Object.keys(localStorage).filter((key) => key.startsWith('slevao-public-data-')).forEach((key) => localStorage.removeItem(key));
    } catch { /* Storage může být vypnuté. */ }
  }

  function showLogin() {
    $('loginBox').classList.remove('hidden');
    $('app').classList.add('hidden');
  }

  async function showApp(session) {
    $('loginBox').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('who').textContent = `${session.user.email} · ${roleOf(session)}`;
    $('sideWho').textContent = session.user.email;
    resetDates();
    await Promise.all([loadRefs(), loadOffers(), loadStores(), loadCategories(), loadStats()]);
  }

  function resetDates() {
    const today = new Date().toISOString().slice(0, 10);
    $('from').value = today;
    $('to').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  }

  async function login() {
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email || !password) return msg('loginMsg', 'Vyplň e-mail i heslo.', 'err');
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Přihlašuji…';
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) return msg('loginMsg', error.message, 'err');
      if (!['admin', 'editor'].includes(roleOf(data.session))) {
        await db.auth.signOut();
        return msg('loginMsg', 'Účet nemá roli admin nebo editor.', 'err');
      }
      await showApp(data.session);
    } catch (error) {
      msg('loginMsg', error.message || 'Přihlášení selhalo.', 'err');
    } finally {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Přihlásit';
    }
  }

  function go(id) {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    $(id)?.classList.add('active');
    document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === id));
    $('pageTitle').textContent = {
      dashboard: 'Přehled', offersPage: 'Nabídky', storesPage: 'Správa obchodů', categoriesPage: 'Kategorie',
    }[id] || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => go(button.dataset.page)));
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => go(button.dataset.go)));
  $('loginBtn').addEventListener('click', login);
  $('password').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); login(); } });
  $('logout').addEventListener('click', async () => { await db.auth.signOut(); showLogin(); });
  $('reload').addEventListener('click', loadOffers);
  $('offerSearch').addEventListener('input', renderOffers);
  $('editClose').addEventListener('click', closeEdit);
  $('editModal').addEventListener('click', (event) => { if (event.target === $('editModal')) closeEdit(); });
  $('storeEditClose').addEventListener('click', closeStoreEdit);
  $('storeEditModal').addEventListener('click', (event) => { if (event.target === $('storeEditModal')) closeStoreEdit(); });
  $('storeSearch').addEventListener('input', renderStores);
  $('storeFilter').addEventListener('change', renderStores);
  $('storeRefresh').addEventListener('click', loadStores);
  $('storeName').addEventListener('input', () => {
    if (!slugManuallyEdited) $('storeSlug').value = slugify($('storeName').value);
  });
  $('storeSlug').addEventListener('input', () => {
    slugManuallyEdited = true;
    $('storeSlug').value = slugify($('storeSlug').value);
  });

  async function loadRefs() {
    const [stores, categories] = await Promise.all([
      db.from('stores').select('id,name').eq('is_active', true).order('name'),
      db.from('categories').select('id,name').eq('is_active', true).order('sort_order'),
    ]);
    if (stores.error || categories.error) return msg('formMsg', (stores.error || categories.error).message, 'err');
    const options = (stores.data || []).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
    $('store').innerHTML = options;
    $('editStore').innerHTML = options;
    $('category').innerHTML = '<option value="">Bez kategorie</option>' + (categories.data || []).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  }

  async function loadOffers() {
    const { data, error } = await db.from('offers')
      .select('id,product_id,store_id,title,price,old_price,image_url,status,valid_from,valid_to,stores(name)')
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      $('offers').innerHTML = `<p>${esc(error.message)}</p>`;
      return;
    }
    allOffers = data || [];
    renderOffers();
    $('recent').innerHTML = allOffers.slice(0, 5).map((offer) => offerHtml(offer, false)).join('') || '<p class="muted">Zatím nejsou žádné nabídky.</p>';
  }

  function offerHtml(offer, full = true) {
    return `<div class="item"><div><span class="pill ${esc(offer.status)}">${esc(offer.status)}</span><h3>${esc(offer.title)}</h3><div><b>${Number(offer.price || 0).toLocaleString('cs-CZ')} Kč</b>${offer.old_price ? ` <small class="muted"><s>${Number(offer.old_price).toLocaleString('cs-CZ')} Kč</s></small>` : ''}</div><small class="muted">${esc(offer.stores?.name || '')} · ${esc(offer.valid_from)} až ${esc(offer.valid_to)}</small></div>${full ? `<div class="actions"><button data-edit="${offer.id}">Upravit</button><button data-copy="${offer.id}">Kopírovat</button><button data-status="published" data-id="${offer.id}">Publikovat</button><button data-status="expired" data-id="${offer.id}">Ukončit</button><button class="danger" data-delete="${offer.id}">Smazat</button></div>` : ''}</div>`;
  }

  function renderOffers() {
    const query = $('offerSearch').value.toLowerCase().trim();
    const rows = allOffers.filter((offer) => !query || offer.title.toLowerCase().includes(query) || (offer.stores?.name || '').toLowerCase().includes(query));
    $('offers').innerHTML = rows.map((offer) => offerHtml(offer, true)).join('') || '<p class="muted">Žádné nabídky.</p>';
    document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', () => setStatus(button.dataset.id, button.dataset.status)));
    document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => removeOffer(button.dataset.delete)));
    document.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openEdit(button.dataset.edit)));
    document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyOffer(button.dataset.copy)));
  }

  function openEdit(id) {
    const offer = allOffers.find((item) => item.id === id);
    if (!offer) return;
    $('editId').value = offer.id;
    $('editTitle').value = offer.title || '';
    $('editStore').value = offer.store_id || '';
    $('editPrice').value = offer.price ?? '';
    $('editOldPrice').value = offer.old_price ?? '';
    $('editImage').value = offer.image_url || '';
    $('editFrom').value = offer.valid_from || '';
    $('editTo').value = offer.valid_to || '';
    $('editStatus').value = offer.status || 'draft';
    clearMsg('editMsg');
    $('editModal').classList.remove('hidden');
  }

  function closeEdit() { $('editModal').classList.add('hidden'); }

  $('editSave').addEventListener('click', async () => {
    const id = $('editId').value;
    const payload = {
      title: $('editTitle').value.trim(), store_id: $('editStore').value,
      price: Number($('editPrice').value), old_price: $('editOldPrice').value ? Number($('editOldPrice').value) : null,
      image_url: nullable($('editImage').value), valid_from: $('editFrom').value, valid_to: $('editTo').value,
      status: $('editStatus').value, published_at: $('editStatus').value === 'published' ? new Date().toISOString() : null,
    };
    if (!payload.title || !payload.store_id || !payload.price || !payload.valid_from || !payload.valid_to) return msg('editMsg', 'Vyplň povinná pole.', 'err');
    const { error } = await db.from('offers').update(payload).eq('id', id);
    if (error) return msg('editMsg', error.message, 'err');
    msg('editMsg', 'Změny byly uloženy.');
    await Promise.all([loadOffers(), loadStats()]);
    setTimeout(closeEdit, 500);
  });

  async function copyOffer(id) {
    const offer = allOffers.find((item) => item.id === id);
    if (!offer) return;
    const payload = {
      product_id: offer.product_id, store_id: offer.store_id, title: `${offer.title} – kopie`, price: offer.price,
      old_price: offer.old_price, image_url: offer.image_url, valid_from: offer.valid_from, valid_to: offer.valid_to,
      status: 'draft', is_verified: true, published_at: null,
    };
    const { error } = await db.from('offers').insert(payload);
    if (error) alert(error.message);
    else { await Promise.all([loadOffers(), loadStats()]); alert('Kopie nabídky byla vytvořena jako koncept.'); }
  }

  async function setStatus(id, status) {
    const { error } = await db.from('offers').update({ status, published_at: status === 'published' ? new Date().toISOString() : null }).eq('id', id);
    if (error) alert(error.message); else await Promise.all([loadOffers(), loadStats()]);
  }

  async function removeOffer(id) {
    if (!confirm('Opravdu smazat nabídku?')) return;
    const { error } = await db.from('offers').delete().eq('id', id);
    if (error) alert(error.message); else await Promise.all([loadOffers(), loadStats()]);
  }

  $('saveBtn').addEventListener('click', async () => {
    const name = $('title').value.trim();
    if (!name || !$('store').value || !$('price').value || !$('from').value || !$('to').value) return msg('formMsg', 'Vyplň povinná pole.', 'err');
    const product = { name, category_id: $('category').value || null, image_url: nullable($('image').value), is_verified: true };
    const { data, error: productError } = await db.from('products').insert(product).select('id').single();
    if (productError) return msg('formMsg', productError.message, 'err');
    const status = $('status').value;
    const { error } = await db.from('offers').insert({
      product_id: data.id, store_id: $('store').value, title: name, price: Number($('price').value),
      old_price: $('oldPrice').value ? Number($('oldPrice').value) : null, image_url: product.image_url,
      valid_from: $('from').value, valid_to: $('to').value, status, is_verified: true,
      published_at: status === 'published' ? new Date().toISOString() : null,
    });
    if (error) return msg('formMsg', error.message, 'err');
    msg('formMsg', 'Nabídka byla uložena.');
    $('offerForm').reset();
    resetDates();
    await Promise.all([loadOffers(), loadStats()]);
  });

  async function loadStores() {
    $('storesList').innerHTML = '<div class="storeEmpty">Načítám obchody…</div>';
    const { data, error } = await db.from('stores')
      .select('id,name,slug,website_url,logo_url,primary_color,is_active')
      .order('name');
    if (error) {
      $('storesList').innerHTML = `<div class="storeEmpty">${esc(error.message)}</div>`;
      return;
    }
    allStores = data || [];
    renderStores();
  }

  function storeLogo(store) {
    const source = nullable(store.logo_url);
    if (source) return `<img src="${esc(source)}" alt="Logo ${esc(store.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('strong'),{className:'storeLogoFallback',textContent:'${esc((store.name || '?').slice(0, 2).toUpperCase())}'}))">`;
    return `<strong class="storeLogoFallback">${esc((store.name || '?').slice(0, 2).toUpperCase())}</strong>`;
  }

  function renderStores() {
    const query = $('storeSearch').value.trim().toLowerCase();
    const filter = $('storeFilter').value;
    const visibleCount = allStores.filter((store) => store.is_active).length;
    const hiddenCount = allStores.length - visibleCount;
    $('storeTotalCount').textContent = allStores.length.toLocaleString('cs-CZ');
    $('storeVisibleCount').textContent = visibleCount.toLocaleString('cs-CZ');
    $('storeHiddenCount').textContent = hiddenCount.toLocaleString('cs-CZ');

    const rows = allStores.filter((store) => {
      if (filter === 'visible' && !store.is_active) return false;
      if (filter === 'hidden' && store.is_active) return false;
      return !query || [store.name, store.slug, store.website_url].some((value) => String(value || '').toLowerCase().includes(query));
    });

    $('storesList').innerHTML = rows.map((store) => {
      const pageUrl = store.slug ? `${encodeURIComponent(store.slug)}.html` : '';
      return `<article class="storeCard ${store.is_active ? '' : 'isHidden'}" data-store-card="${store.id}">
        <div class="storeLogoPreview">${storeLogo(store)}</div>
        <div class="storeMeta">
          <div class="storeTitleLine"><h3>${esc(store.name)}</h3><span class="pill ${store.is_active ? 'visible' : 'hiddenStore'}">${store.is_active ? '● Viditelný na webu' : '○ Skrytý z webu'}</span></div>
          <div class="storeDetails"><span>Slug: <code>${esc(store.slug || 'není nastaven')}</code></span><span><i class="colorDot" style="background:${esc(store.primary_color || '#159e94')}"></i>${esc(store.primary_color || 'bez barvy')}</span><span>${store.website_url ? esc(store.website_url) : 'Bez webu'}</span></div>
        </div>
        <div class="actions">
          <button data-store-edit="${store.id}">✏️ Upravit</button>
          ${pageUrl ? `<a href="${pageUrl}" target="_blank" rel="noopener">↗ Otevřít stránku</a>` : ''}
          <button class="${store.is_active ? 'dangerBtn' : 'successBtn'}" data-store-toggle="${store.id}">${store.is_active ? '🙈 Skrýt z webu' : '👁️ Zobrazit na webu'}</button>
        </div>
      </article>`;
    }).join('') || '<div class="storeEmpty">Žádný obchod neodpovídá filtru.</div>';

    $('storesList').querySelectorAll('[data-store-edit]').forEach((button) => button.addEventListener('click', () => openStoreEdit(button.dataset.storeEdit)));
    $('storesList').querySelectorAll('[data-store-toggle]').forEach((button) => button.addEventListener('click', () => toggleStore(button.dataset.storeToggle)));
  }

  function openStoreEdit(id) {
    const store = allStores.find((item) => item.id === id);
    if (!store) return;
    $('storeEditId').value = store.id;
    $('storeEditName').value = store.name || '';
    $('storeEditSlug').value = store.slug || '';
    $('storeEditWeb').value = store.website_url || '';
    $('storeEditLogo').value = store.logo_url || '';
    $('storeEditColor').value = /^#[0-9a-f]{6}$/i.test(store.primary_color || '') ? store.primary_color : '#159e94';
    $('storeEditColorText').value = store.primary_color || '#159e94';
    $('storeEditVisible').checked = Boolean(store.is_active);
    $('storeEditVisibilityText').textContent = store.is_active ? 'Obchod se zobrazuje na veřejném webu.' : 'Obchod je na veřejném webu skrytý.';
    clearMsg('storeEditMsg');
    $('storeEditModal').classList.remove('hidden');
  }

  function closeStoreEdit() { $('storeEditModal').classList.add('hidden'); }

  $('storeEditColor').addEventListener('input', () => { $('storeEditColorText').value = $('storeEditColor').value; });
  $('storeEditColorText').addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test($('storeEditColorText').value)) $('storeEditColor').value = $('storeEditColorText').value;
  });
  $('storeEditVisible').addEventListener('change', () => {
    $('storeEditVisibilityText').textContent = $('storeEditVisible').checked ? 'Obchod se bude zobrazovat na veřejném webu.' : 'Obchod bude z veřejného webu skrytý.';
  });

  $('storeEditSave').addEventListener('click', async () => {
    const id = $('storeEditId').value;
    const name = $('storeEditName').value.trim();
    const color = $('storeEditColorText').value.trim();
    if (!name) return msg('storeEditMsg', 'Zadej název obchodu.', 'err');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return msg('storeEditMsg', 'Firemní barva musí mít formát například #159e94.', 'err');
    const payload = {
      name,
      website_url: nullable($('storeEditWeb').value),
      logo_url: nullable($('storeEditLogo').value),
      primary_color: color || null,
      is_active: $('storeEditVisible').checked,
    };
    $('storeEditSave').disabled = true;
    const { error } = await db.from('stores').update(payload).eq('id', id);
    $('storeEditSave').disabled = false;
    if (error) return msg('storeEditMsg', error.message, 'err');
    clearPublicCache();
    msg('storeEditMsg', payload.is_active ? 'Obchod byl uložen a je viditelný na webu.' : 'Obchod byl uložen a skryt z webu.');
    await Promise.all([loadStores(), loadRefs(), loadOffers(), loadStats()]);
    setTimeout(closeStoreEdit, 650);
  });

  async function toggleStore(id) {
    const store = allStores.find((item) => item.id === id);
    if (!store) return;
    const next = !store.is_active;
    const question = next
      ? `Znovu zobrazit obchod „${store.name}“ na webu?`
      : `Skrýt obchod „${store.name}“ z veřejného webu? Jeho data se nesmažou a můžeš ho kdykoliv znovu zobrazit.`;
    if (!confirm(question)) return;
    const { error } = await db.from('stores').update({ is_active: next }).eq('id', id);
    if (error) return alert(error.message);
    clearPublicCache();
    await Promise.all([loadStores(), loadRefs(), loadStats()]);
  }

  $('storeSave').addEventListener('click', async () => {
    const name = $('storeName').value.trim();
    const slug = slugify($('storeSlug').value || name);
    const color = $('storeColor').value.trim();
    if (!name || !slug) return msg('storeMsg', 'Zadej název a slug obchodu.', 'err');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return msg('storeMsg', 'Firemní barva musí mít formát například #159e94.', 'err');
    const { error } = await db.from('stores').insert({
      name, slug, website_url: nullable($('storeWeb').value), logo_url: nullable($('storeLogo').value),
      primary_color: color || null, is_active: $('storeActive').checked,
    });
    if (error) return msg('storeMsg', error.message, 'err');
    clearPublicCache();
    msg('storeMsg', 'Obchod byl přidán. Pro novou stránku obchodu je ještě potřeba odpovídající HTML soubor.');
    $('storeForm').reset();
    $('storeColor').value = '#159e94';
    $('storeActive').checked = true;
    slugManuallyEdited = false;
    await Promise.all([loadStores(), loadRefs(), loadStats()]);
  });

  async function loadCategories() {
    const { data, error } = await db.from('categories').select('id,name,sort_order,is_active').order('sort_order');
    if (error) { $('categoriesList').innerHTML = `<p>${esc(error.message)}</p>`; return; }
    $('categoriesList').innerHTML = (data || []).map((category) => `<div class="item"><div><h3>${esc(category.name)}</h3><small class="muted">Pořadí: ${esc(category.sort_order)}</small></div><div class="actions"><button data-cat="${category.id}" data-active="${!category.is_active}">${category.is_active ? 'Deaktivovat' : 'Aktivovat'}</button></div></div>`).join('') || '<p class="muted">Žádné kategorie.</p>';
    document.querySelectorAll('[data-cat]').forEach((button) => button.addEventListener('click', async () => {
      const { error: updateError } = await db.from('categories').update({ is_active: button.dataset.active === 'true' }).eq('id', button.dataset.cat);
      if (updateError) alert(updateError.message); else await Promise.all([loadCategories(), loadRefs(), loadStats()]);
    }));
  }

  $('categorySave').addEventListener('click', async () => {
    const name = $('categoryName').value.trim();
    if (!name) return msg('categoryMsg', 'Zadej název kategorie.', 'err');
    const { error } = await db.from('categories').insert({ name, sort_order: Number($('categoryOrder').value || 100), is_active: true });
    if (error) return msg('categoryMsg', error.message, 'err');
    msg('categoryMsg', 'Kategorie byla přidána.');
    $('categoryForm').reset();
    $('categoryOrder').value = 100;
    await Promise.all([loadCategories(), loadRefs(), loadStats()]);
  });

  async function loadStats() {
    const [offers, published, stores, activeStores, categories] = await Promise.all([
      db.from('offers').select('id', { count: 'exact', head: true }),
      db.from('offers').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      db.from('stores').select('id', { count: 'exact', head: true }),
      db.from('stores').select('id', { count: 'exact', head: true }).eq('is_active', true),
      db.from('categories').select('id', { count: 'exact', head: true }),
    ]);
    $('sOffers').textContent = offers.count ?? 0;
    $('sPublished').textContent = published.count ?? 0;
    $('sStores').textContent = `${activeStores.count ?? 0}/${stores.count ?? 0}`;
    $('sCategories').textContent = categories.count ?? 0;
  }

  db.auth.getSession().then(({ data }) => {
    const session = data.session;
    if (session && ['admin', 'editor'].includes(roleOf(session))) showApp(session); else showLogin();
  }).catch(showLogin);
});
