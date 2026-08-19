import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260819133759_web_push_notifications_v1.sql';
const edgePath = 'supabase/functions/web-push/index.ts';
const edgeConfigPath = 'supabase/functions/web-push/config.toml';
const clientPath = 'assets/web-push.js';
const swPath = 'sw.js';
const accountPath = 'ucet.html';

for (const path of [migrationPath, edgePath, edgeConfigPath, clientPath, swPath, accountPath]) {
  if (!fs.existsSync(path)) throw new Error(`Missing Web Push file: ${path}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const edge = fs.readFileSync(edgePath, 'utf8');
const edgeConfig = fs.readFileSync(edgeConfigPath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
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
  "admin.auth.getUser(token)",
  "action === 'subscribe'",
  "action === 'unsubscribe'",
  "action === 'dispatch'",
  "if (!isInternal(req)) return json({ error: 'Unauthorized' }, 401)",
  "webpush.setVapidDetails(VAPID_SUBJECT",
  'webpush.sendNotification',
  "statusCode === 404 || statusCode === 410",
  ".from('web_push_subscriptions')",
  ".from('web_push_deliveries')",
  ".update({ sent_at:",
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
  "navigator.serviceWorker.register(SW_URL, { scope: '/' })",
  'current.pushManager.subscribe({',
  'userVisibleOnly: true',
  'applicationServerKey: base64UrlToUint8Array(publicKey)',
  "action: 'subscribe'",
  "action: 'unsubscribe'",
  'authorization: `Bearer ${current.access_token}`',
  'send_test: sendTest',
  "event.stopImmediatePropagation()",
]) {
  if (!client.includes(needle)) throw new Error(`Missing Web Push client guard: ${needle}`);
}
if (/private[_-]?key/i.test(client)) throw new Error('Client Web Push module must never reference a VAPID private key.');

for (const needle of [
  "self.addEventListener('push'",
  'self.registration.showNotification',
  "self.addEventListener('notificationclick'",
  "clients.matchAll({ type: 'window', includeUncontrolled: true })",
  'clients.openWindow(target)',
]) {
  if (!sw.includes(needle)) throw new Error(`Missing Service Worker push behavior: ${needle}`);
}

if (!/assets\/web-push\.js\?v=20260819-1/.test(account)) {
  throw new Error('ucet.html must load the Web Push client module.');
}

console.log('Web Push notification pipeline guards OK');
