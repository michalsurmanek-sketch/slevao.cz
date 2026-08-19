(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PUSH_URL = `${SUPABASE_URL}/functions/v1/web-push`;
  const SW_URL = '/sw.js?v=20260819-1';
  const db = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  let subscribed = false;
  let syncing = false;

  const button = () => document.getElementById('enableBrowserAlerts');
  const statusNode = () => document.getElementById('accountMessage');

  function showMessage(text, bad = false) {
    const node = statusNode();
    if (!node) return;
    node.textContent = text;
    node.style.color = bad ? '#b32631' : '#0b7a58';
  }

  function supported() {
    return Boolean(
      window.isSecureContext
      && 'Notification' in window
      && 'serviceWorker' in navigator
      && 'PushManager' in window
    );
  }

  function base64UrlToUint8Array(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function session() {
    if (!db) return null;
    const { data } = await db.auth.getSession();
    return data?.session || null;
  }

  async function registration(create = false) {
    if (!supported()) return null;
    let current = await navigator.serviceWorker.getRegistration('/');
    if (!current && create) {
      current = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    }
    if (current && create) await navigator.serviceWorker.ready;
    return current;
  }

  async function currentSubscription() {
    const current = await registration(false);
    return current ? current.pushManager.getSubscription() : null;
  }

  async function fetchPublicKey() {
    const response = await fetch(PUSH_URL, {
      method: 'GET',
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.public_key) throw new Error(body?.error || 'Push konfigurace není dostupná.');
    return String(body.public_key);
  }

  async function saveSubscription(subscription, sendTest = false) {
    const current = await session();
    if (!current?.access_token) throw new Error('Pro push upozornění se nejdřív přihlas.');
    const response = await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${current.access_token}`,
        apikey: SUPABASE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'subscribe',
        subscription: subscription.toJSON(),
        send_test: sendTest,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Push subscription se nepodařilo uložit.');
    return body;
  }

  async function removeSubscription(subscription) {
    if (!subscription) return;
    const current = await session();
    if (current?.access_token) {
      await fetch(PUSH_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${current.access_token}`,
          apikey: SUPABASE_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'unsubscribe', endpoint: subscription.endpoint }),
      }).catch(() => {});
    }
    await subscription.unsubscribe().catch(() => {});
  }

  function renderState() {
    const node = button();
    if (!node) return;
    if (!supported()) {
      node.textContent = 'Oznámení nejsou podporována';
      node.disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      node.textContent = 'Oznámení jsou blokována';
      node.disabled = true;
      return;
    }
    if (subscribed) {
      node.textContent = 'Oznámení aktivní';
      node.disabled = true;
      return;
    }
    node.textContent = Notification.permission === 'granted' ? 'Dokončit oznámení' : 'Zapnout oznámení';
    node.disabled = false;
  }

  async function refresh({ syncServer = true } = {}) {
    if (!supported()) {
      subscribed = false;
      renderState();
      return;
    }
    const sub = await currentSubscription().catch(() => null);
    subscribed = Boolean(sub && Notification.permission === 'granted');
    renderState();
    if (subscribed && syncServer && !syncing) {
      const current = await session();
      if (!current) return;
      syncing = true;
      try { await saveSubscription(sub, false); }
      catch (error) { console.warn('slevao_web_push_sync_failed', error); }
      finally { syncing = false; }
    }
  }

  async function enableFromUser() {
    if (!supported()) throw new Error('Tento prohlížeč nepodporuje Web Push upozornění.');
    if (!(await session())) throw new Error('Pro push upozornění se nejdřív přihlas.');

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Bez povolení oznámení nelze push upozornění zapnout.');

    const current = await registration(true);
    if (!current) throw new Error('Service Worker se nepodařilo zaregistrovat.');
    let sub = await current.pushManager.getSubscription();
    if (!sub) {
      const publicKey = await fetchPublicKey();
      sub = await current.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
    }

    const result = await saveSubscription(sub, true);
    subscribed = true;
    renderState();
    showMessage(result?.test_sent
      ? 'Push upozornění jsou aktivní. Testovací oznámení bylo odesláno.'
      : 'Push upozornění jsou aktivní. SLEVAO tě upozorní i bez otevřeného webu.');
  }

  async function signOutFromUser() {
    if (!db) throw new Error('Odhlášení není dostupné.');
    const sub = await currentSubscription().catch(() => null);
    if (sub) await removeSubscription(sub);
    const { error } = await db.auth.signOut();
    if (error) throw error;
    subscribed = false;
    renderState();
    showMessage('Byl jsi odhlášen.');
  }

  document.addEventListener('click', (event) => {
    const alertTarget = event.target.closest?.('#enableBrowserAlerts');
    if (alertTarget) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alertTarget.disabled = true;
      enableFromUser().catch((error) => {
        subscribed = false;
        renderState();
        showMessage(error?.message || 'Push upozornění se nepodařilo zapnout.', true);
      });
      return;
    }

    const logoutTarget = event.target.closest?.('#logout');
    if (!logoutTarget) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    logoutTarget.disabled = true;
    signOutFromUser().catch((error) => {
      logoutTarget.disabled = false;
      showMessage(error?.message || 'Odhlášení se nepodařilo dokončit.', true);
    });
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    refresh().catch(() => { subscribed = false; renderState(); });
  }, { once: true });

  db?.auth?.onAuthStateChange?.((event) => {
    if (event === 'SIGNED_OUT') {
      currentSubscription().then((sub) => sub?.unsubscribe?.()).catch(() => {});
      subscribed = false;
      renderState();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      setTimeout(() => refresh(), 0);
    }
  });

  window.SlevaoWebPush = {
    isSupported: supported,
    isSubscribed: () => subscribed,
    refresh,
    unsubscribe: async () => {
      const sub = await currentSubscription();
      if (sub) await removeSubscription(sub);
      subscribed = false;
      renderState();
    },
  };
})();
