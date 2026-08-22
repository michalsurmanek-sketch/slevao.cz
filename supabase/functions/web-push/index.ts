import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const VAPID_SUBJECT = 'mailto:info@slevao.cz';
const SITE_ORIGIN = 'https://slevao.cz';
const MAX_ACTIVE_SUBSCRIPTIONS = 8;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function bearer(req: Request) {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function isInternal(req: Request) {
  const token = bearer(req);
  return Boolean(
    (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET)
    || (token && token === SERVICE_ROLE)
  );
}

async function requireUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function rowOf<T>(data: T | T[] | null | undefined): T | null {
  if (Array.isArray(data)) return (data[0] as T) || null;
  return (data as T) || null;
}

async function ensureVapidKeys() {
  let { data, error } = await admin.rpc('web_push_get_vapid_keys');
  if (error) throw error;
  let row = rowOf<any>(data);

  if (!row?.public_key || !row?.private_key) {
    const generated = webpush.generateVAPIDKeys();
    const stored = await admin.rpc('web_push_store_vapid_keys', {
      p_public_key: generated.publicKey,
      p_private_key: generated.privateKey,
    });
    if (stored.error) throw stored.error;
    ({ data, error } = await admin.rpc('web_push_get_vapid_keys'));
    if (error) throw error;
    row = rowOf<any>(data);
  }

  if (!row?.public_key || !row?.private_key) throw new Error('VAPID configuration is unavailable.');
  webpush.setVapidDetails(VAPID_SUBJECT, row.public_key, row.private_key);
  return { publicKey: String(row.public_key), privateKey: String(row.private_key) };
}

function isDirectPrivateOrLocalHost(hostname: string) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.lan')
    || host === 'metadata.google.internal'
  ) return true;
  if (host.includes(':')) return true;

  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b, c] = octets;
  return Boolean(
    a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 192 && b === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
  );
}

function cleanSubscription(raw: any) {
  const endpoint = String(raw?.endpoint || '').trim();
  const p256dh = String(raw?.keys?.p256dh || '').trim();
  const auth = String(raw?.keys?.auth || '').trim();
  if (endpoint.length < 16 || endpoint.length > 2048) throw new Error('Neplatná délka push endpointu.');
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('Neplatný push endpoint.'); }
  if (url.protocol !== 'https:') throw new Error('Push endpoint musí používat HTTPS.');
  if (url.username || url.password) throw new Error('Push endpoint nesmí obsahovat přihlašovací údaje.');
  if (url.port && url.port !== '443') throw new Error('Push endpoint musí používat standardní HTTPS port.');
  if (isDirectPrivateOrLocalHost(url.hostname)) throw new Error('Privátní nebo lokální push endpoint není povolen.');
  if (p256dh.length < 40 || p256dh.length > 256 || auth.length < 8 || auth.length > 128) {
    throw new Error('Neplatné šifrovací klíče push subscription.');
  }
  const expirationRaw = Number(raw?.expirationTime);
  const expirationTime = Number.isFinite(expirationRaw) && expirationRaw > 0
    ? new Date(expirationRaw).toISOString()
    : null;
  return { endpoint: url.toString(), p256dh, auth, expirationTime };
}

function payloadFor(notification: any) {
  const url = notification.product_id
    ? `${SITE_ORIGIN}/produkt.html?id=${encodeURIComponent(notification.product_id)}`
    : `${SITE_ORIGIN}/ucet.html`;
  return JSON.stringify({
    title: notification.title || 'SLEVAO.cz upozornění',
    body: notification.message || 'Sledovaná nabídka právě splnila tvoje podmínky.',
    url,
    icon: `${SITE_ORIGIN}/favicon.svg`,
    badge: `${SITE_ORIGIN}/favicon.svg`,
    tag: `slevao-${notification.id}`,
    notification_id: notification.id,
    product_id: notification.product_id || null,
    type: notification.type || 'notification',
  });
}

async function recordDelivery(notificationId: string, subscription: any, status: string, errorText = '') {
  const { data: previous } = await admin
    .from('web_push_deliveries')
    .select('attempts')
    .eq('notification_id', notificationId)
    .eq('subscription_id', subscription.id)
    .maybeSingle();
  const attempts = Number(previous?.attempts || 0) + 1;
  const now = new Date().toISOString();
  const { error } = await admin.from('web_push_deliveries').upsert({
    notification_id: notificationId,
    subscription_id: subscription.id,
    status,
    attempts,
    last_attempt_at: now,
    delivered_at: status === 'sent' ? now : null,
    error_text: errorText ? errorText.slice(0, 1000) : null,
    updated_at: now,
  }, { onConflict: 'notification_id,subscription_id' });
  if (error) console.error('web_push_delivery_write_failed', error.message);
}

async function sendToSubscription(subscription: any, payload: string, notificationId: string | null) {
  try {
    await webpush.sendNotification({
      endpoint: subscription.endpoint,
      expirationTime: subscription.expiration_time ? new Date(subscription.expiration_time).getTime() : null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, payload, { TTL: 21600, urgency: 'high' });

    const now = new Date().toISOString();
    await admin.from('web_push_subscriptions').update({
      is_active: true,
      last_success_at: now,
      last_failure_at: null,
      last_error: null,
      updated_at: now,
    }).eq('id', subscription.id);
    if (notificationId) await recordDelivery(notificationId, subscription, 'sent');
    return { sent: true, gone: false };
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || error?.status || 0);
    const gone = statusCode === 404 || statusCode === 410;
    const message = String(error?.body || error?.message || error || 'Web Push send failed').slice(0, 1000);
    const now = new Date().toISOString();
    await admin.from('web_push_subscriptions').update({
      is_active: !gone,
      last_failure_at: now,
      last_error: message,
      updated_at: now,
    }).eq('id', subscription.id);
    if (notificationId) await recordDelivery(notificationId, subscription, gone ? 'gone' : 'failed', message);
    return { sent: false, gone };
  }
}

async function dispatch(notificationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) return json({ error: 'Invalid notification id' }, 400);
  await ensureVapidKeys();

  const { data: notification, error: notificationError } = await admin
    .from('notifications')
    .select('id,user_id,type,title,message,product_id,sent_at')
    .eq('id', notificationId)
    .maybeSingle();
  if (notificationError) throw notificationError;
  if (!notification) return json({ ok: true, skipped: 'notification_not_found' });

  const { data: subscriptions, error: subscriptionError } = await admin
    .from('web_push_subscriptions')
    .select('id,endpoint,p256dh,auth,expiration_time')
    .eq('user_id', notification.user_id)
    .eq('is_active', true);
  if (subscriptionError) throw subscriptionError;
  if (!subscriptions?.length) return json({ ok: true, sent: 0, subscriptions: 0 });

  const { data: delivered } = await admin
    .from('web_push_deliveries')
    .select('subscription_id,status')
    .eq('notification_id', notification.id)
    .eq('status', 'sent');
  const alreadySent = new Set((delivered || []).map((row: any) => String(row.subscription_id)));

  let sent = 0;
  let gone = 0;
  let failed = 0;
  const payload = payloadFor(notification);
  for (const subscription of subscriptions) {
    if (alreadySent.has(String(subscription.id))) continue;
    const result = await sendToSubscription(subscription, payload, notification.id);
    if (result.sent) sent += 1;
    else if (result.gone) gone += 1;
    else failed += 1;
  }

  if (sent > 0) {
    await admin.from('notifications')
      .update({ sent_at: notification.sent_at || new Date().toISOString() })
      .eq('id', notification.id);
  }

  return json({ ok: true, sent, gone, failed, subscriptions: subscriptions.length });
}

async function enforceSubscriptionCap(userId: string, now: string) {
  const { data: activeRows, error: activeError } = await admin
    .from('web_push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (activeError) throw activeError;
  const overflowIds = (activeRows || [])
    .slice(MAX_ACTIVE_SUBSCRIPTIONS)
    .map((row: any) => row.id)
    .filter(Boolean);
  if (!overflowIds.length) return;
  const { error } = await admin.from('web_push_subscriptions')
    .update({ is_active: false, updated_at: now, last_error: 'Deactivated by per-user subscription cap.' })
    .in('id', overflowIds);
  if (error) throw error;
}

async function subscribe(req: Request, body: any) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const subscription = cleanSubscription(body?.subscription);
  const sendTest = body?.send_test === true;
  const now = new Date().toISOString();
  const userAgent = String(req.headers.get('user-agent') || '').slice(0, 500) || null;

  const { data: existing, error: existingError } = await admin
    .from('web_push_subscriptions')
    .select('id,user_id,is_active,last_error')
    .eq('endpoint', subscription.endpoint)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && String(existing.user_id) !== String(user.id)) {
    return json({ error: 'Push endpoint už je přiřazen jinému účtu.' }, 409);
  }
  if (existing && existing.is_active === false && !sendTest) {
    return json({ ok: true, subscribed: false, requires_test: true });
  }

  const { data: saved, error } = await admin.from('web_push_subscriptions').upsert({
    user_id: user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    expiration_time: subscription.expirationTime,
    user_agent: userAgent,
    is_active: true,
    last_seen_at: now,
    updated_at: now,
  }, { onConflict: 'endpoint' }).select('id').single();
  if (error) throw error;

  if (sendTest) {
    await ensureVapidKeys();
    const testPayload = JSON.stringify({
      title: 'Oznámení SLEVAO jsou aktivní ✓',
      body: 'Až sledovaná cena klesne, upozornění dorazí i bez otevřeného webu.',
      url: `${SITE_ORIGIN}/ucet.html`,
      icon: `${SITE_ORIGIN}/favicon.svg`,
      badge: `${SITE_ORIGIN}/favicon.svg`,
      tag: 'slevao-web-push-test',
      type: 'push_test',
    });
    const result = await sendToSubscription({
      id: saved.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      expiration_time: subscription.expirationTime,
    }, testPayload, null);
    if (!result.sent) {
      await admin.from('web_push_subscriptions')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', saved.id);
      return json({ ok: true, subscribed: false, test_sent: false, requires_test: true });
    }
  }

  await enforceSubscriptionCap(user.id, new Date().toISOString());
  return json({ ok: true, subscribed: true, test_sent: sendTest });
}

async function unsubscribe(req: Request, body: any) {
  const user = await requireUser(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const endpoint = String(body?.endpoint || '').trim();
  if (!endpoint) return json({ error: 'Endpoint is required' }, 400);
  const { error } = await admin.from('web_push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);
  if (error) throw error;
  return json({ ok: true, subscribed: false });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (req.method === 'GET') {
      const keys = await ensureVapidKeys();
      return json({ public_key: keys.publicKey });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    if (action === 'subscribe') return await subscribe(req, body);
    if (action === 'unsubscribe') return await unsubscribe(req, body);
    if (action === 'dispatch') {
      if (!isInternal(req)) return json({ error: 'Unauthorized' }, 401);
      return await dispatch(String(body?.notification_id || ''));
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('web_push_error', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
