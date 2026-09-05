import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818081500_public_leaflet_source_health_snapshot.sql', root), 'utf8');
const cacheSql = readFileSync(new URL('supabase/migrations/20260901154850_cache_public_store_feed_health.sql', root), 'utf8');
const syncHealthSql = readFileSync(new URL('supabase/migrations/20260905072000_store_product_sync_health_minimum_guard.sql', root), 'utf8');

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

assert.match(syncHealthSql, /st\.minimum_offer_count/i, 'Store sync health musí načítat minimum_offer_count.');
assert.match(syncHealthSql, /active_offer_count\s*<\s*minimum_offer_count\s+then\s+'degraded'/i, 'Zdroj pod minimálním počtem aktivních nabídek musí být degraded.');
assert.match(syncHealthSql, /when active_offer_count\s*>\s*0\s+then\s+'ok'/i, 'Zdroj může být ok až po kontrole minimálního počtu nabídek.');

console.log('Public feed-health snapshot OK');
