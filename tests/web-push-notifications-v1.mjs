import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260819133759_web_push_notifications_v1.sql';
const hardeningMigrationPath = 'supabase/migrations/20260819135501_harden_web_push_subscription_constraints.sql';
const edgePath = 'supabase/functions/web-push/index.ts';
const edgeConfigPath = 'supabase/functions/web-push/config.toml';
const clientPath = 'assets/web-push.js';
const pwaPath = 'assets/pwa-install.js';
const swPath = 'service-worker.js';
const accountPath = 'ucet.html';

for (const path of [migrationPath, hardeningMigrationPath, edgePath, edgeConfigPath, clientPath, pwaPath, swPath, accountPath]) {
  if (!fs.existsSync(path)) throw new Error(`Missing Web Push file: ${path}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const hardening = fs.readFileSync(hardeningMigrationPath, 'utf8');
const edge = fs.readFileSync(edgePath, 'utf8');
const edgeConfig = fs.readFileSync(edgeConfigPath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const pwa = fs.readFileSync(pwaPath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');
const account = fs.readFileSync(accountPath, 'utf8');

for (const needle of [
  'create table public.web_push_subscriptions',
  'create table public.web_push_deliveries',
  'alter table public.web_push_subscriptions enable row level security',
  'alter table public.web_push_deliveries enable row level security',
  'revoke all on table public.web_push_subscriptions from public, anon, authenticated',
  'revoke all on table public.web_push_deliveries from public, anon, authenticated',
  'grant all on table public.web_push_subscriptions to service_role',
  'grant all on table public.web_push_deliveries to service_role',
  "where ds.name='slevao_web_push_vapid_private'",
  'revoke execute on function public.web_push_get_vapid_keys() from anon, authenticated',
  'revoke execute on function public.web_push_store_vapid_keys(text,text) from anon, authenticated',
  "where ds.name='slevao_cron_secret'",
  "url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/web-push'",
  "jsonb_build_object('action','dispatch','notification_id',new.id)",
  'create trigger notifications_dispatch_web_push',
]) {
  if (!migration.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing Web Push migration guard: ${needle}`);
}

for (const needle of [
  "conname='web_push_subscriptions_endpoint_length_chk'",
  'check (length(endpoint) between 16 and 2048)',
  "conname='web_push_subscriptions_user_agent_length_chk'",
  'check (user_agent is null or length(user_agent) <= 500)',
]) {
  if (!hardening.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing Web Push hardening migration guard: ${needle}`);
}

for (const forbidden of [
  /grant\s+all\s+on\s+table\s+public\.web_push_(?:subscriptions|deliveries)\s+to\s+(?:anon|authenticated)/i,
  /grant\s+select[\s\S]*web_push_(?:subscriptions|deliveries)[\s\S]*to\s+(?:anon|authenticated)/i,
  /slevao_web_push_vapid_private[^\n]*['\"][A-Za-z0-9_-]{30,}['\"]/i,
]) {
  if (forbidden.test(migration)) throw new Error(`Unsafe Web Push migration behavior: ${forbidden}`);
}

for (const needle of [
  "import webpush from 'npm:web-push@3.6.7'",
  "const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''",
  'const MAX_ACTIVE_SUBSCRIPTIONS = 8',
  'admin.auth.getUser(token)',
  "action === 'subscribe'",
  "action === 'unsubscribe'",
  "action === 'dispatch'",
  "if (!isInternal(req)) return json({ error: 'Unauthorized' }, 401)",
  'function isDirectPrivateOrLocalHost(hostname: string)',
  "host === 'localhost'",
  "host.endsWith('.local')",
  "host === 'metadata.google.internal'",
  "if (host.includes(':')) return true",
  'if (isDirectPrivateOrLocalHost(url.hostname))',
  'if (url.username || url.password)',
  "if (url.port && url.port !== '443')",
  ".select('id,user_id,is_active,last_error')",
  'Push endpoint už je přiřazen jinému účtu.',
  '.slice(MAX_ACTIVE_SUBSCRIPTIONS)',
  "last_error: 'Deactivated by per-user subscription cap.'",
  'webpush.setVapidDetails(VAPID_SUBJECT',
  'webpush.sendNotification',
  'statusCode === 404 || statusCode === 410',
  ".from('web_push_subscriptions')",
  ".from('web_push_deliveries')",
  '.update({ sent_at:',
]) {
  if (!edge.includes(needle)) throw new Error(`Missing Web Push Edge guard: ${needle}`);
}
if (edge.includes("'00000000-0000-0000-0000-000000000000'")) {
  throw new Error('Web Push test delivery must not use a synthetic notification foreign key.');
}
if (/privateKey\s*[:=][^\n]*['\"][A-Za-z0-9_-]{30,}/.test(edge)) {
  throw new Error('VAPID private key must never be hardcoded in Edge source.');
}
if (!/verify_jwt\s*=\s*false/.test(edgeConfig)) throw new Error('Web Push custom-auth deployment must stay explicit.');

for (const needle of [
  "const SW_URL = '/service-worker.js'",
  "navigator.serviceWorker.register(SW_URL, { scope: '/' })",
  "navigator.serviceWorker.getRegistration('/')",
  'const expected = new URL(SW_URL, location.origin).href',
  'current?.active?.scriptURL',
  'current?.waiting?.scriptURL',
  'current?.installing?.scriptURL',
  'currentScript !== expected',
  'current.pushManager.subscribe({',
  'userVisibleOnly: true',
  'applicationServerKey: base64UrlToUint8Array(publicKey)',
  "action: 'subscribe'",
  "action: 'unsubscribe'",
  'authorization: `Bearer ${current.access_token}`',
  'send_test: sendTest',
  'event.stopImmediatePropagation()',
  "event.target.closest?.('#logout')",
  'async function signOutFromUser()',
  'if (sub) await removeSubscription(sub)',
  'await db.auth.signOut()',
]) {
  if (!client.includes(needle)) throw new Error(`Missing Web Push client guard: ${needle}`);
}
if (client.includes('/sw.js')) throw new Error('Web Push client must not register the legacy /sw.js root worker.');
if (/private[_-]?key/i.test(client)) throw new Error('Client Web Push module must never reference a VAPID private key.');

if (!pwa.includes("navigator.serviceWorker.register('/service-worker.js', { scope:'/' })")) {
  throw new Error('PWA must register the same unified /service-worker.js root worker.');
}
if (pwa.includes("register('/sw.js")) throw new Error('PWA must never register the legacy /sw.js worker.');

for (const needle of [
  "self.addEventListener('install'",
  "self.addEventListener('activate'",
  "self.addEventListener('fetch'",
  "self.addEventListener('push'",
  'self.registration.showNotification',
  "self.addEventListener('notificationclick'",
  "self.clients.matchAll({ type:'window', includeUncontrolled:true })",
  "url.pathname.endsWith('/ucet.html')",
  "client.visibilityState === 'visible'",
  'if (visibleAccount) return',
  'self.clients.openWindow(target)',
]) {
  if (!sw.includes(needle)) throw new Error(`Missing unified Service Worker behavior: ${needle}`);
}
if (!sw.includes("const CACHE_NAME = 'slevao-shell-")) throw new Error('Unified service worker lost PWA shell caching.');

if (!/assets\/web-push\.js\?v=[a-z0-9-]+/i.test(account)) {
  throw new Error('ucet.html must load the current unified Web Push client module.');
}

console.log('Web Push notification pipeline guards OK');
await import('./web-push-subscription-owner.mjs');
