import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818081500_public_leaflet_source_health_snapshot.sql', root), 'utf8');

assert.match(sql, /create table if not exists public\.public_leaflet_source_health_snapshot/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /for select\s+to anon, authenticated\s+using \(true\)/i);
assert.match(sql, /revoke all on function public\.sync_public_leaflet_source_health_trigger\(\) from public, anon, authenticated, service_role;/i);
assert.match(sql, /with \(security_invoker = true\)/i);
assert.match(sql, /left join public\.public_leaflet_source_health_snapshot src on src\.store_id=s\.id/i);
assert.doesNotMatch(sql, /left join public\.leaflet_sources ls on ls\.store_id=s\.id;\s*$/im, 'Veřejný health view znovu čte interní leaflet_sources přímo.');

console.log('Public feed-health snapshot OK');
