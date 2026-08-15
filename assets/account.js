(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const params = new URLSearchParams(location.search);
  const redirect = params.get('redirect') || 'ucet.html';
  let session = null;
  let notificationChannel = null;

  function message(text, bad = false) {
    $('accountMessage').textContent = text;
    $('accountMessage').style.color = bad ? '#b32631' : '#0b7a58';
  }

  async function processPendingAlert() {
    if (!session) return;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_ALERT_KEY) || 'null'); } catch {}
    if (!pending?.product_id || !(Number(pending.target_price) > 0)) return;

    const { error } = await db.from('price_alerts').insert({
      user_id: session.user.id,
      product_id: pending.product_id,
      search_term: pending.search_term || null,
      target_price: Number(pending.target_price),
      store_id: pending.store_id || null,
      is_active: true
    });
    if (error) throw error;
    localStorage.removeItem(PENDING_ALERT_KEY);
    message(`Hlídač pro ${pending.search_term || 'produkt'} do ${money(pending.target_price)} Kč byl aktivován.`);
  }

  async function loadCounts() {
    if (!session) return;
    const [lists, alerts, unread, notifications] = await Promise.all([
      db.from('shopping_lists').select('id', { count:'exact', head:true }).eq('user_id', session.user.id).eq('is_archived', false),
      db.from('price_alerts').select('id', { count:'exact', head:true }).eq('user_id', session.user.id).eq('is_active', true),
      db.from('notifications').select('id', { count:'exact', head:true }).eq('user_id', session.user.id).eq('is_read', false),
      db.from('notifications').select('id', { count:'exact', head:true }).eq('user_id', session.user.id)
    ]);
    $('accountListCount').textContent = String(lists.count || 0);
    $('accountAlertCount').textContent = String(alerts.count || 0);
    $('accountUnreadCount').textContent = String(unread.count || 0);
    $('accountNotificationCount').textContent = String(notifications.count || 0);
    $('markAllRead').disabled = !(unread.count > 0);
  }

  async function loadAlerts() {
    if (!session) return;
    const { data, error } = await db.from('price_alerts')
      .select('id,product_id,search_term,target_price,store_id,is_active,last_triggered_at,created_at,products(name,brand,quantity_text),stores(name,slug)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending:false });
    if (error) throw error;

    $('alerts').innerHTML = data?.length ? data.map((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
      const productLink = row.product_id ? `produkt.html?id=${encodeURIComponent(row.product_id)}` : 'index.html#dealsSection';
      return `<article class="sfAlertRow" data-id="${esc(row.id)}">
        <div><strong><a href="${productLink}" style="color:inherit">${esc(product?.name || row.search_term || 'Produkt')}</a></strong><div class="sfMuted">Do ${money(row.target_price)} Kč${store?.name ? ` · pouze ${esc(store.name)}` : ' · všechny obchody'}${row.last_triggered_at ? ` · naposledy splněno ${new Date(row.last_triggered_at).toLocaleDateString('cs-CZ')}` : ''}</div></div>
        <button class="sfButton" type="button" data-toggle="${row.is_active}">${row.is_active ? 'Pozastavit' : 'Zapnout'}</button>
        <button class="sfButton bad" type="button" data-delete>Odstranit</button>
      </article>`;
    }).join('') : '<div class="sfEmpty">Nemáš nastavený žádný cenový hlídač. Najdi produkt a nastav cílovou cenu.</div>';
  }

  function notificationHtml(row) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers;
    const store = Array.isArray(offer?.stores) ? offer.stores[0] : offer?.stores;
    const created = new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(row.created_at));
    const productName = product?.name || 'Sledovaný produkt';
    const target = row.product_id ? `produkt.html?id=${encodeURIComponent(row.product_id)}` : (store?.slug ? `${encodeURIComponent(store.slug)}.html` : 'index.html#dealsSection');
    const icon = row.type === 'favorite_offer' ? '♥' : '↓';
    const kind = row.type === 'favorite_offer' ? 'Oblíbený produkt' : 'Cenový hlídač';
    return `<article class="sfNotification ${row.is_read ? '' : 'unread'}" data-notification-id="${esc(row.id)}" data-target="${esc(target)}">
      <div class="sfNotificationIcon" aria-hidden="true">${icon}</div>
      <div><div class="sfNotificationTitle">${esc(row.title || 'Nové cenové upozornění')}</div><div class="sfNotificationText">${esc(row.message || productName)}</div><div class="sfNotificationMeta">${kind} · ${esc(productName)}${store?.name ? ` · ${esc(store.name)}` : ''} · ${created}</div></div>
      <div>${row.is_read ? '' : '<span class="sfUnreadDot" title="Nepřečtené"></span>'}<button class="sfButton" type="button" data-open-notification style="margin-top:8px">Otevřít</button></div>
    </article>`;
  }

  async function loadNotifications() {
    if (!session) return;
    const { data, error } = await db.from('notifications')
      .select('id,type,title,message,offer_id,product_id,price_alert_id,is_read,created_at,products(name,brand,quantity_text),offers(price,valid_from,valid_to,stores(name,slug))')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending:false })
      .limit(100);
    if (error) throw error;
    $('notifications').innerHTML = data?.length
      ? data.map(notificationHtml).join('')
      : '<div class="sfEmpty">Zatím nemáš žádné upozornění. Oblíb si produkt nebo nastav cílovou cenu a nové akce se zde objeví automaticky.</div>';
  }

  async function loadAccountData() {
    await Promise.all([loadCounts(), loadAlerts(), loadNotifications()]);
  }

  function subscribeNotifications() {
    if (!session || notificationChannel) return;
    notificationChannel = db.channel(`slevao-notifications-${session.user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}`
      }, () => loadAccountData().catch(() => {}))
      .subscribe();
  }

  async function renderSession() {
    const { data: { session: current } } = await db.auth.getSession();
    session = current;
    $('authArea').hidden = Boolean(session);
    $('profileArea').hidden = !session;

    if (!session) {
      if (notificationChannel) {
        await db.removeChannel(notificationChannel);
        notificationChannel = null;
      }
      return;
    }

    $('accountEmail').textContent = session.user.email || 'Přihlášený uživatel';
    try {
      await processPendingAlert();
      await loadAccountData();
      subscribeNotifications();
    } catch (error) {
      message(error.message || 'Účet se nepodařilo načíst.', true);
    }
  }

  async function signIn() {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!email || !password) { message('Vyplň e-mail a heslo.', true); return; }
    $('signIn').disabled = true;
    const { error } = await db.auth.signInWithPassword({ email, password });
    $('signIn').disabled = false;
    if (error) { message(error.message, true); return; }
    localStorage.setItem('slevao-account-email', email);
    await renderSession();
    if (redirect && redirect !== 'ucet.html') setTimeout(() => { location.href = redirect; }, 700);
  }

  async function signUp() {
    const email = $('registerEmail').value.trim();
    const password = $('registerPassword').value;
    if (!email || password.length < 6) { message('Zadej platný e-mail a heslo alespoň o 6 znacích.', true); return; }
    $('signUp').disabled = true;
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: new URL(`ucet.html?redirect=${encodeURIComponent(redirect)}`, location.href).href }
    });
    $('signUp').disabled = false;
    if (error) { message(error.message, true); return; }
    localStorage.setItem('slevao-account-email', email);
    if (data.session) {
      message('Účet byl vytvořen a jsi přihlášený.');
      await renderSession();
    } else {
      message('Účet byl vytvořen. Potvrď registraci v e-mailu.');
    }
  }

  async function googleLogin() {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: new URL(`ucet.html?redirect=${encodeURIComponent(redirect)}`, location.href).href }
    });
    if (error) message(`Přihlášení Google není dostupné: ${error.message}`, true);
  }

  $('signIn').addEventListener('click', signIn);
  $('signUp').addEventListener('click', signUp);
  $('googleLogin').addEventListener('click', googleLogin);
  $('logout').addEventListener('click', async () => {
    await db.auth.signOut();
    session = null;
    message('Byl jsi odhlášen.');
    renderSession();
  });

  $('alerts').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    try {
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) {
        const active = toggle.dataset.toggle === 'true';
        const { error } = await db.from('price_alerts').update({ is_active: !active }).eq('id', row.dataset.id);
        if (error) throw error;
      }
      if (event.target.closest('[data-delete]')) {
        const { error } = await db.from('price_alerts').delete().eq('id', row.dataset.id);
        if (error) throw error;
      }
      await loadAccountData();
    } catch (error) { message(error.message, true); }
  });

  $('notifications').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-open-notification]');
    const row = event.target.closest('[data-notification-id]');
    if (!button || !row) return;
    button.disabled = true;
    try {
      const { error } = await db.from('notifications').update({ is_read: true }).eq('id', row.dataset.notificationId);
      if (error) throw error;
      location.href = row.dataset.target || 'index.html#dealsSection';
    } catch (error) {
      button.disabled = false;
      message(error.message || 'Upozornění se nepodařilo otevřít.', true);
    }
  });

  $('markAllRead').addEventListener('click', async () => {
    if (!session) return;
    $('markAllRead').disabled = true;
    const { error } = await db.from('notifications')
      .update({ is_read: true })
      .eq('user_id', session.user.id)
      .eq('is_read', false);
    if (error) { message(error.message, true); return; }
    message('Všechna upozornění jsou označená jako přečtená.');
    await Promise.all([loadCounts(), loadNotifications()]);
  });

  const remembered = params.get('email') || localStorage.getItem('slevao-account-email') || '';
  $('loginEmail').value = remembered;
  $('registerEmail').value = remembered;
  db.auth.onAuthStateChange(() => setTimeout(renderSession, 0));
  renderSession();
})();
