(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const params = new URLSearchParams(location.search);
  const redirect = params.get('redirect') || 'ucet.html';
  let session = null;
  let notificationChannel = null;
  let notificationPoll = 0;
  let hydratedUserId = null;
  let authWork = Promise.resolve();
  const SEEN_NOTIFICATION_KEY = 'slevao-seen-live-notifications';

  function message(text, bad = false) {
    $('accountMessage').textContent = text;
    $('accountMessage').style.color = bad ? '#b32631' : '#0b7a58';
  }

  function setListOwner(userId) {
    const normalized = String(userId || '').trim();
    if (window.SlevaoListStorage?.setActiveUser) {
      window.SlevaoListStorage.setActiveUser(normalized || null);
      return;
    }
    try {
      if (normalized) localStorage.setItem(ACTIVE_USER_KEY, normalized);
      else localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {}
  }

  function seenNotificationIds() {
    try {
      const ids = JSON.parse(localStorage.getItem(SEEN_NOTIFICATION_KEY) || '[]');
      return new Set(Array.isArray(ids) ? ids.slice(-100) : []);
    } catch { return new Set(); }
  }

  function rememberNotification(id) {
    if (!id) return;
    const ids = [...seenNotificationIds(), id].slice(-100);
    try { localStorage.setItem(SEEN_NOTIFICATION_KEY, JSON.stringify(ids)); } catch {}
  }

  function updateBrowserAlertButton() {
    const button = $('enableBrowserAlerts');
    if (!button) return;
    if (!('Notification' in window)) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.textContent = Notification.permission === 'granted' ? 'Oznámení zapnuta' : 'Zapnout oznámení';
    button.disabled = Notification.permission === 'granted';
  }

  function deliverBrowserNotification(row) {
    if (!row?.id || seenNotificationIds().has(row.id)) return;
    rememberNotification(row.id);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const target = row.product_id
      ? new URL(`produkt.html?id=${encodeURIComponent(row.product_id)}`, location.href).href
      : new URL('ucet.html', location.href).href;
    const notice = new Notification(row.title || 'Slevao.cz našlo požadovanou cenu', {
      body: row.message || 'Sledovaný produkt právě splnil nastavený cenový limit.',
      icon: new URL('favicon.svg', location.href).href,
      tag: `slevao-${row.id}`
    });
    notice.onclick = () => {
      window.focus();
      location.href = target;
      notice.close();
    };
  }

  function ensurePendingAlertRequestId(pending) {
    const existing = String(pending?.request_id || '').trim().toLowerCase();
    if (UUID_PATTERN.test(existing)) return existing;
    const generated = globalThis.crypto?.randomUUID?.() || '';
    if (!UUID_PATTERN.test(generated)) return '';
    pending.request_id = generated;
    try { localStorage.setItem(PENDING_ALERT_KEY, JSON.stringify(pending)); } catch {}
    return generated;
  }

  async function verifyPendingAlertRetry(userId, pending, requestId) {
    let query = db.from('price_alerts')
      .select('id')
      .eq('id', requestId)
      .eq('user_id', userId)
      .eq('product_id', pending.product_id)
      .eq('target_price', Number(pending.target_price));
    query = pending.store_id ? query.eq('store_id', pending.store_id) : query.is('store_id', null);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  }

  async function processPendingAlert(userId) {
    if (!userId) return;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_ALERT_KEY) || 'null'); } catch {}
    if (!pending?.product_id || !(Number(pending.target_price) > 0)) return;

    const requestId = ensurePendingAlertRequestId(pending);
    const payload = {
      ...(requestId ? { id:requestId } : {}),
      user_id: userId,
      product_id: pending.product_id,
      search_term: pending.search_term || null,
      target_price: Number(pending.target_price),
      store_id: pending.store_id || null,
      is_active: true
    };
    const { error } = await db.from('price_alerts').insert(payload);
    if (error) {
      const isRetryConflict = requestId && error.code === '23505';
      if (!isRetryConflict || !(await verifyPendingAlertRetry(userId, pending, requestId))) throw error;
    }
    localStorage.removeItem(PENDING_ALERT_KEY);
    message(`Hlídač pro ${pending.search_term || 'produkt'} do ${money(pending.target_price)} Kč byl aktivován.`);
  }

  async function loadCounts(userId = session?.user?.id) {
    if (!userId) return;
    const [lists, alerts, unread, notifications] = await Promise.all([
      db.from('shopping_lists').select('id', { count:'exact', head:true }).eq('user_id', userId).eq('is_archived', false),
      db.from('price_alerts').select('id', { count:'exact', head:true }).eq('user_id', userId).eq('is_active', true),
      db.from('notifications').select('id', { count:'exact', head:true }).eq('user_id', userId).eq('is_read', false),
      db.from('notifications').select('id', { count:'exact', head:true }).eq('user_id', userId)
    ]);
    if (String(session?.user?.id || '') !== String(userId)) return;
    $('accountListCount').textContent = String(lists.count || 0);
    $('accountAlertCount').textContent = String(alerts.count || 0);
    $('accountUnreadCount').textContent = String(unread.count || 0);
    $('accountNotificationCount').textContent = String(notifications.count || 0);
    $('markAllRead').disabled = !(unread.count > 0);
  }

  async function loadAlerts(userId = session?.user?.id) {
    if (!userId) return;
    const { data, error } = await db.from('price_alerts')
      .select('id,product_id,search_term,target_price,store_id,is_active,last_triggered_at,created_at,products(name,brand,quantity_text,image_url),stores(name,slug)')
      .eq('user_id', userId)
      .order('created_at', { ascending:false });
    if (error) throw error;
    if (String(session?.user?.id || '') !== String(userId)) return;

    $('alerts').innerHTML = data?.length ? data.map((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
      const productLink = row.product_id ? `produkt.html?id=${encodeURIComponent(row.product_id)}` : 'index.html#dealsSection';
      const media = product?.image_url
        ? `<img src="${esc(product.image_url)}" alt="" loading="lazy">`
        : '<span aria-hidden="true">%</span>';
      return `<article class="sfAlertRow ${row.is_active ? '' : 'is-paused'}" data-id="${esc(row.id)}">
        <a class="sfAlertMedia" href="${productLink}" aria-label="Detail produktu ${esc(product?.name || row.search_term || 'Produkt')}">${media}</a>
        <div class="sfAlertCopy"><strong><a href="${productLink}">${esc(product?.name || row.search_term || 'Produkt')}</a></strong><div class="sfMuted">Do ${money(row.target_price)} Kč${store?.name ? ` · pouze ${esc(store.name)}` : ' · všechny obchody'}${row.last_triggered_at ? ` · naposledy splněno ${new Date(row.last_triggered_at).toLocaleDateString('cs-CZ')}` : ''}</div><span class="sfAlertState">${row.is_active ? 'Aktivně hlídáme' : 'Hlídač je pozastavený'}</span></div>
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

  async function loadNotifications(userId = session?.user?.id) {
    if (!userId) return;
    const { data, error } = await db.from('notifications')
      .select('id,type,title,message,offer_id,product_id,price_alert_id,is_read,created_at,products(name,brand,quantity_text),offers(price,valid_from,valid_to,stores(name,slug))')
      .eq('user_id', userId)
      .order('created_at', { ascending:false })
      .limit(100);
    if (error) throw error;
    if (String(session?.user?.id || '') !== String(userId)) return;
    $('notifications').innerHTML = data?.length
      ? data.map(notificationHtml).join('')
      : '<div class="sfEmpty">Zatím nemáš žádné upozornění. Oblíb si produkt nebo nastav cílovou cenu a nové akce se zde objeví automaticky.</div>';
  }

  async function loadAccountData(userId = session?.user?.id) {
    if (!userId) return;
    await Promise.all([loadCounts(userId), loadAlerts(userId), loadNotifications(userId)]);
  }

  async function stopNotifications() {
    if (notificationChannel) {
      await db.removeChannel(notificationChannel);
      notificationChannel = null;
    }
    clearInterval(notificationPoll);
    notificationPoll = 0;
  }

  function subscribeNotifications(userId) {
    if (!userId || notificationChannel) return;
    notificationChannel = db.channel(`slevao-notifications-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}`
      }, ({ new: row }) => {
        if (String(session?.user?.id || '') !== String(userId)) return;
        deliverBrowserNotification(row);
        message(row.message || 'Sledovaný produkt právě splnil nastavenou cenu.');
        loadAccountData(userId).catch(() => {});
      })
      .subscribe();
    clearInterval(notificationPoll);
    notificationPoll = window.setInterval(async () => {
      if (String(session?.user?.id || '') !== String(userId)) return;
      const { data } = await db.from('notifications')
        .select('id,title,message,product_id')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending:false })
        .limit(5);
      (data || []).reverse().forEach(deliverBrowserNotification);
      await loadCounts(userId);
    }, 60000);
  }

  function renderAuthShell(signedIn) {
    if (signedIn) document.body.classList.remove('accountRegistrationPending');
    const registrationPending = document.body.classList.contains('accountRegistrationPending');
    $('authArea').hidden = signedIn || registrationPending;
    $('profileArea').hidden = !signedIn;
    document.body.classList.toggle('accountSignedIn', signedIn);
  }

  async function applySession(nextSession) {
    session = nextSession || null;
    const userId = String(session?.user?.id || '');
    setListOwner(userId || null);
    const changed = hydratedUserId !== userId;
    renderAuthShell(Boolean(userId));

    if (!changed) {
      if (userId) $('accountEmail').textContent = session.user.email || 'Přihlášený uživatel';
      return;
    }

    await stopNotifications();

    if (!userId) {
      hydratedUserId = '';
      return;
    }

    $('accountEmail').textContent = session.user.email || 'Přihlášený uživatel';
    try {
      await processPendingAlert(userId);
      await loadAccountData(userId);
      if (String(session?.user?.id || '') !== userId) return;
      subscribeNotifications(userId);
      hydratedUserId = userId;
    } catch (error) {
      message(error.message || 'Účet se nepodařilo načíst.', true);
    }
  }

  function queueSessionApply(nextSession) {
    authWork = authWork.catch(() => {}).then(() => applySession(nextSession));
    return authWork;
  }

  async function signIn() {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!email || !password) { message('Vyplň e-mail a heslo.', true); return; }
    $('signIn').disabled = true;
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    $('signIn').disabled = false;
    if (error) { message(error.message, true); return; }
    localStorage.setItem('slevao-account-email', email);
    if (data.session) await queueSessionApply(data.session);
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
      await queueSessionApply(data.session);
    } else {
      document.body.classList.add('accountRegistrationPending');
      $('authArea').hidden = true;
      message('Účet byl vytvořen. Potvrď registraci v e-mailu; potom se můžeš přihlásit.');
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
    document.body.classList.remove('accountRegistrationPending');
    message('Byl jsi odhlášen.');
    await queueSessionApply(null);
  });

  $('alerts').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-id]');
    const userId = session?.user?.id;
    if (!row || !userId) return;
    try {
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) {
        const active = toggle.dataset.toggle === 'true';
        const { error } = await db.from('price_alerts')
          .update({ is_active: !active })
          .eq('id', row.dataset.id)
          .eq('user_id', userId);
        if (error) throw error;
      }
      if (event.target.closest('[data-delete]')) {
        const { error } = await db.from('price_alerts')
          .delete()
          .eq('id', row.dataset.id)
          .eq('user_id', userId);
        if (error) throw error;
      }
      await loadAccountData(userId);
    } catch (error) { message(error.message, true); }
  });

  $('notifications').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-open-notification]');
    const row = event.target.closest('[data-notification-id]');
    const userId = session?.user?.id;
    if (!button || !row || !userId) return;
    button.disabled = true;
    try {
      const { error } = await db.from('notifications')
        .update({ is_read: true })
        .eq('id', row.dataset.notificationId)
        .eq('user_id', userId);
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
    const userId = session.user.id;
    const { error } = await db.from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) { message(error.message, true); return; }
    message('Všechna upozornění jsou označená jako přečtená.');
    await Promise.all([loadCounts(userId), loadNotifications(userId)]);
  });

  $('enableBrowserAlerts')?.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    updateBrowserAlertButton();
    message(permission === 'granted'
      ? 'Oznámení jsou zapnutá. Když sledovaná cena klesne, Slevao tě upozorní.'
      : 'Oznámení nebyla povolena. Upozornění zůstanou dostupná v účtu.', permission === 'denied');
  });

  const remembered = params.get('email') || localStorage.getItem('slevao-account-email') || '';
  $('loginEmail').value = remembered;
  $('registerEmail').value = remembered;
  updateBrowserAlertButton();

  const { data:{ subscription:authSubscription } } = db.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
      session = nextSession || session;
      setListOwner(session?.user?.id || null);
      if (event === 'USER_UPDATED' && session?.user?.email) $('accountEmail').textContent = session.user.email;
      return;
    }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      queueSessionApply(event === 'SIGNED_OUT' ? null : nextSession).catch(() => {});
    }
  });
  window.addEventListener('pagehide', () => {
    authSubscription?.unsubscribe?.();
    stopNotifications().catch(() => {});
  }, { once:true });
})();