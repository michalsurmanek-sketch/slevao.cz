(() => {
  'use strict';

  const { url: SUPABASE_URL, key: SUPABASE_KEY } = window.SlevaoSupabase;
  const PUSH_URL = `${SUPABASE_URL}/functions/v1/web-push`;
  const SW_URL = '/service-worker.js';
  const db = window.SlevaoSupabase.getClient();
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
    if (create) {
      const expected = new URL(SW_URL, location.origin).href;
      const currentScript = current?.active?.scriptURL
        || current?.waiting?.scriptURL
        || current?.installing?.scriptURL
        || '';
      if (!current || currentScript !== expected) {
        current = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      }
      await navigator.serviceWorker.ready;
    }
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
    if (!response.ok) {
      const error = new Error(body?.error || 'Push subscription se nepodařilo uložit.');
      error.status = response.status;
      throw error;
    }
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
    const browserReady = Boolean(sub && Notification.permission === 'granted');
    if (!browserReady) {
      subscribed = false;
      renderState();
      return;
    }
    if (!syncServer) {
      subscribed = true;
      renderState();
      return;
    }
    if (syncing) return;
    const current = await session();
    if (!current) {
      subscribed = false;
      renderState();
      return;
    }

    syncing = true;
    subscribed = false;
    renderState();
    try {
      const result = await saveSubscription(sub, false);
      subscribed = result?.subscribed === true;
      if (!subscribed && result?.requires_test) {
        showMessage('Oznámení je potřeba znovu potvrdit tlačítkem.', true);
      }
    } catch (error) {
      subscribed = false;
      console.warn('slevao_web_push_sync_failed', error);
    } finally {
      syncing = false;
      renderState();
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

    let result;
    try {
      result = await saveSubscription(sub, true);
    } catch (error) {
      // A temporary server/push-provider failure must not destroy a valid browser
      // subscription. A 409 is the one recoverable ownership conflict where a new
      // browser endpoint is required.
      if (Number(error?.status || 0) === 409) await removeSubscription(sub);
      throw error;
    }

    if (result?.subscribed !== true) {
      if (result?.gone === true) await removeSubscription(sub);
      throw new Error('Push subscription se nepodařilo aktivovat. Zkus oznámení zapnout znovu.');
    }

    subscribed = true;
    renderState();
    if (result?.test_sent === true) {
      showMessage('Push upozornění jsou aktivní. Testovací oznámení bylo odesláno.');
    } else {
      showMessage('Push upozornění jsou aktivní. Test se teď nepodařilo doručit, ale zařízení zůstává přihlášené.', true);
    }
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
