import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818090000_move_offer_search_cache_private.sql', root), 'utf8');

assert.match(sql, /alter materialized view public\.public_offer_search_cache set schema private;/i);
assert.match(sql, /grant usage on schema private to anon, authenticated;/i);
assert.match(sql, /grant select on private\.public_offer_search_cache to anon, authenticated, service_role;/i);
assert.match(sql, /replace\([\s\S]*'public\.public_offer_search_cache'[\s\S]*'private\.public_offer_search_cache'/i);
assert.match(sql, /cron\.alter_job\([\s\S]*job_id := 129[\s\S]*REFRESH MATERIALIZED VIEW private\.public_offer_search_cache/i);
assert.doesNotMatch(sql, /create materialized view public\.public_offer_search_cache/i);

console.log('Private public-offer search cache migration OK');
