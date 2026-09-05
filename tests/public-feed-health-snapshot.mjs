import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818081500_public_leaflet_source_health_snapshot.sql', root), 'utf8');
const cacheSql = readFileSync(new URL('supabase/migrations/20260901154850_cache_public_store_feed_health.sql', root), 'utf8');
const syncHealthSql = readFileSync(new URL('supabase/migrations/20260905072000_store_product_sync_health_minimum_guard.sql', root), 'utf8');
const syncHealthSecuritySql = readFileSync(new URL('supabase/migrations/20260905072100_restore_store_product_sync_health_security_invoker.sql', root), 'utf8');
const explicitHealthSql = readFileSync(new URL('supabase/migrations/20260905072700_preserve_explicit_store_sync_health.sql', root), 'utf8');

assert.match(sql, /create table if not exists public\.public_leaflet_source_health_snapshot/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /for select\s+to anon, authenticated\s+using \(true\)/i);
assert.match(sql, /revoke all on function public\.sync_public_leaflet_source_health_trigger\(\) from public, anon, authenticated, service_role;/i);
assert.match(sql, /with \(security_invoker = true\)/i);
assert.match(sql, /left join public\.public_leaflet_source_health_snapshot src on src\.store_id=s\.id/i);
assert.doesNotMatch(sql, /left join public\.leaflet_sources ls on ls\.store_id=s\.id;\s*$/im, 'Veřejný health view znovu čte interní leaflet_sources přímo.');

assert.match(cacheSql, /create table if not exists public\.public_store_feed_health_cache/i);
assert.match(cacheSql, /enable row level security/i);
assert.match(cacheSql, /for select\s+to anon, authenticated\s+using \(true\)/i);
assert.match(cacheSql, /security definer\s+set search_path = pg_catalog, public, private/i);
assert.match(cacheSql, /revoke all on function private\.refresh_public_store_feed_health_cache\(\) from public, anon, authenticated;/i);
assert.match(cacheSql, /with \(security_invoker = true\)/i);
assert.match(cacheSql, /left join public\.public_store_feed_health_cache cache on cache\.store_id = s\.id/i);
assert.match(cacheSql, /cron\.schedule\([\s\S]*'refresh-public-store-feed-health-cache'[\s\S]*'\*\/5 \* \* \* \*'/i);

const finalView = cacheSql.slice(cacheSql.lastIndexOf('create or replace view public.public_store_feed_health'));
assert.doesNotMatch(finalView, /from public\.offers|from public\.leaflet_imports/i, 'Veřejný health view nesmí při návštěvě znovu agregovat nabídky nebo importy.');

assert.match(syncHealthSql, /with \(security_invoker = true\) as/i, 'Store sync health view musí po přepsání zůstat security_invoker.');
assert.match(syncHealthSql, /st\.minimum_offer_count/i, 'Store sync health musí načítat minimum_offer_count.');
assert.match(syncHealthSql, /active_offer_count\s*<\s*minimum_offer_count\s+then\s+'degraded'/i, 'Zdroj pod minimálním počtem aktivních nabídek musí být degraded.');
assert.match(syncHealthSql, /when active_offer_count\s*>\s*0\s+then\s+'ok'/i, 'Zdroj může být ok až po kontrole minimálního počtu nabídek.');
assert.match(syncHealthSecuritySql, /alter view public\.store_product_sync_health set \(security_invoker = true\)/i, 'Opravná migrace musí explicitně obnovit security_invoker na produkci.');

assert.match(explicitHealthSql, /with \(security_invoker = true\) as/i, 'Explicit health oprava nesmí znovu shodit security_invoker.');
const explicitStateIndex = explicitHealthSql.indexOf("when state_health_status = any");
const explicitErrorIndex = explicitHealthSql.indexOf("when state_health_status = 'error'::text or last_error is not null");
const minimumIndex = explicitHealthSql.indexOf('and active_offer_count < minimum_offer_count');
const activeOkIndex = explicitHealthSql.indexOf("when active_offer_count > 0 then 'ok'::text");
assert.ok(explicitStateIndex >= 0 && explicitStateIndex < activeOkIndex, 'Explicitní degraded/blocked/waiting status se nesmí přepsat na ok jen kvůli aktivním nabídkám.');
assert.ok(explicitErrorIndex >= 0 && explicitErrorIndex < activeOkIndex, 'Explicitní error se nesmí přepsat na ok jen kvůli aktivním nabídkám.');
assert.ok(minimumIndex >= 0 && minimumIndex < activeOkIndex, 'Minimum aktivních nabídek musí být vyhodnoceno před ok.');

console.log('Public feed-health snapshot OK');
