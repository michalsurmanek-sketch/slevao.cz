(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (v) => Number(v || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const params = new URLSearchParams(location.search);
  const redirect = params.get('redirect') || 'ucet.html';
  let session = null;

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
    const [lists, alerts] = await Promise.all([
      db.from('shopping_lists').select('id',{ count:'exact', head:true }).eq('user_id', session.user.id).eq('is_archived', false),
      db.from('price_alerts').select('id',{ count:'exact', head:true }).eq('user_id', session.user.id).eq('is_active', true)
    ]);
    $('accountListCount').textContent = String(lists.count || 0);
    $('accountAlertCount').textContent = String(alerts.count || 0);
  }

  async function loadAlerts() {
    const { data, error } = await db.from('price_alerts')
      .select('id,product_id,search_term,target_price,store_id,is_active,last_triggered_at,created_at,products(name,brand,quantity_text),stores(name,slug)')
      .eq('user_id', session.user.id).order('created_at', { ascending:false });
    if (error) throw error;
    $('alerts').innerHTML = data?.length ? data.map((row) => {
      const product = row.products;
      const store = row.stores;
      return `<article class="sfAlertRow" data-id="${row.id}"><div><strong>${esc(product?.name || row.search_term || 'Produkt')}</strong><div class="sfMuted">Do ${money(row.target_price)} Kč${store?.name ? ` · pouze ${esc(store.name)}` : ' · všechny obchody'}${row.last_triggered_at ? ` · naposledy splněno ${new Date(row.last_triggered_at).toLocaleDateString('cs-CZ')}` : ''}</div></div><button class="sfButton" type="button" data-toggle="${row.is_active}">${row.is_active ? 'Pozastavit' : 'Zapnout'}</button><button class="sfButton bad" type="button" data-delete>Odstranit</button></article>`;
    }).join('') : '<div class="sfEmpty">Nemáš nastavený žádný cenový hlídač.</div>';
  }

  async function renderSession() {
    const { data: { session: current } } = await db.auth.getSession();
    session = current;
    $('authArea').hidden = Boolean(session);
    $('profileArea').hidden = !session;
    if (!session) return;
    $('accountEmail').textContent = session.user.email || 'Přihlášený uživatel';
    try {
      await processPendingAlert();
      await Promise.all([loadCounts(), loadAlerts()]);
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
    await renderSession();
    if (redirect && redirect !== 'ucet.html') setTimeout(() => { location.href = redirect; }, 700);
  }

  async function signUp() {
    const email = $('registerEmail').value.trim();
    const password = $('registerPassword').value;
    if (!email || password.length < 6) { message('Zadej platný e-mail a heslo alespoň o 6 znacích.', true); return; }
    $('signUp').disabled = true;
    const { data, error } = await db.auth.signUp({
      email, password,
      options: { emailRedirectTo: new URL(`ucet.html?redirect=${encodeURIComponent(redirect)}`, location.href).href }
    });
    $('signUp').disabled = false;
    if (error) { message(error.message, true); return; }
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
  $('logout').addEventListener('click', async () => { await db.auth.signOut(); session = null; message('Byl jsi odhlášen.'); renderSession(); });

  $('alerts').addEventListener('click', async (event) => {
    const row = event.target.closest('[data-id]');
    if (!row) return;
    try {
      if (event.target.closest('[data-toggle]')) {
        const active = event.target.closest('[data-toggle]').dataset.toggle === 'true';
        const { error } = await db.from('price_alerts').update({ is_active: !active }).eq('id', row.dataset.id);
        if (error) throw error;
      }
      if (event.target.closest('[data-delete]')) {
        const { error } = await db.from('price_alerts').delete().eq('id', row.dataset.id);
        if (error) throw error;
      }
      await Promise.all([loadCounts(), loadAlerts()]);
    } catch (error) { message(error.message, true); }
  });

  const remembered = params.get('email') || localStorage.getItem('slevao-account-email') || '';
  $('loginEmail').value = remembered;
  $('registerEmail').value = remembered;
  db.auth.onAuthStateChange(() => setTimeout(renderSession, 0));
  renderSession();
})();
