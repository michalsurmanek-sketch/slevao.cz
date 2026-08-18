import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const fn = read('supabase/functions/process-leaflet/index.ts');
const config = read('supabase/functions/process-leaflet/config.toml');
const migration = read('supabase/migrations/20260818135700_process_leaflet_custom_auth_boundary.sql');

assert.match(config, /^verify_jwt\s*=\s*false\s*$/m, 'process-leaflet musí zůstat v custom-auth režimu pro DB cron spouštěče.');
assert.match(fn, /allowedByService[\s\S]*SERVICE_ROLE_KEY/, 'process-leaflet neověřuje service-role volání.');
assert.match(fn, /allowedByCron[\s\S]*x-cron-secret[\s\S]*CRON_SECRET/, 'process-leaflet neověřuje cron secret.');
assert.match(fn, /allowedByUser[\s\S]*\['admin', 'editor'\]/, 'process-leaflet neomezuje uživatelský přístup na admin/editor.');

for (const signature of [
  'dispatch_queued_leaflet_imports',
  'trigger_process_leaflet_import',
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${signature}`), `${signature} není source-controlled.`);
}
assert.match(migration, /functions\/v1\/process-leaflet/, 'DB spouštěče nevolají process-leaflet.');
assert.match(migration, /x-cron-secret/, 'DB spouštěče neposílají cron secret.');
assert.match(migration, /revoke all on function public\.dispatch_queued_leaflet_imports\(integer\) from public, anon, authenticated;/, 'Queue dispatcher není odebraný klientským rolím.');
assert.match(migration, /revoke all on function public\.trigger_process_leaflet_import\(uuid\) from public, anon, authenticated;/, 'Ruční trigger není odebraný klientským rolím.');
assert.match(migration, /grant execute on function public\.dispatch_queued_leaflet_imports\(integer\) to service_role;/, 'Queue dispatcher nemá explicitní service_role grant.');
assert.match(migration, /grant execute on function public\.trigger_process_leaflet_import\(uuid\) to service_role;/, 'Ruční trigger nemá explicitní service_role grant.');

console.log('process-leaflet custom auth boundary OK');
