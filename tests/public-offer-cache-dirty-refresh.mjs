import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'supabase/migrations/20260825210843_conditional_public_offer_search_cache_refresh.sql';
assert.ok(fs.existsSync(path), 'conditional public offer cache refresh migration is missing');
const sql = fs.readFileSync(path, 'utf8');

for (const token of [
  'private.public_offer_search_cache_refresh_state',
  'change_version = change_version + 1',
  'last_refreshed_version = v_start_version',
  "pg_try_advisory_xact_lock(hashtextextended('slevao:public_offer_search_cache_refresh', 0))",
  'refresh materialized view concurrently private.public_offer_search_cache',
  "'dirty_remaining', v_current_version > v_start_version",
  'trg_public_offer_search_cache_dirty_offers',
  'trg_public_offer_search_cache_dirty_products',
  'trg_public_offer_search_cache_dirty_stores',
  'trg_public_offer_search_cache_dirty_categories',
  "'*/5 * * * *'",
  "select private.refresh_public_offer_search_cache_if_dirty(false);",
  'revoke all on table private.public_offer_search_cache_refresh_state from public, anon, authenticated',
  'revoke all on function private.refresh_public_offer_search_cache_if_dirty(boolean) from public, anon, authenticated'
]) {
  assert.ok(sql.includes(token), `missing dirty-refresh guard: ${token}`);
}

assert.match(sql, /if not p_force and v_start_version <= v_last_refreshed_version then[\s\S]*'reason', 'clean'/);
assert.match(sql, /after insert or update or delete or truncate on public\.offers[\s\S]*for each statement/);
assert.match(sql, /after insert or update or delete or truncate on public\.products[\s\S]*for each statement/);

const hotspotFixPath = 'supabase/migrations/20260827142500_remove_public_offer_cache_dirty_lock_hotspot.sql';
assert.ok(fs.existsSync(hotspotFixPath), 'public offer cache dirty lock-hotspot migration is missing');
const hotspotFixSql = fs.readFileSync(hotspotFixPath, 'utf8');

for (const token of [
  'private.public_offer_search_cache_dirty_transactions',
  'pg_current_xact_id()::text',
  'on conflict (transaction_id) do update',
  'select coalesce(array_agg(transaction_id order by transaction_id)',
  'delete from private.public_offer_search_cache_dirty_transactions',
  "'processed_transactions'",
  "'pending_transactions'",
  "'dirty_remaining', v_pending_count > 0",
  'revoke all on table private.public_offer_search_cache_dirty_transactions from public, anon, authenticated'
]) {
  assert.ok(hotspotFixSql.includes(token), `missing lock-hotspot guard: ${token}`);
}

const markerStart = hotspotFixSql.indexOf('create or replace function private.mark_public_offer_search_cache_dirty()');
const markerEnd = hotspotFixSql.indexOf('revoke all on function private.mark_public_offer_search_cache_dirty()', markerStart);
assert.ok(markerStart >= 0 && markerEnd > markerStart, 'dirty marker function body is missing');
const markerSql = hotspotFixSql.slice(markerStart, markerEnd);
assert.doesNotMatch(markerSql, /public_offer_search_cache_refresh_state/, 'dirty marker must not row-lock the singleton refresh-state row');
assert.doesNotMatch(markerSql, /change_version\s*=\s*change_version\s*\+\s*1/, 'dirty marker must not increment the singleton state row');
assert.match(markerSql, /insert into private\.public_offer_search_cache_dirty_transactions/);
assert.doesNotMatch(hotspotFixSql, /set\s+lock_timeout/i, 'cache lock-hotspot fix must remove contention instead of hiding it with a longer lock timeout');

const pennyPath = 'supabase/migrations/20260825211752_penny_no_change_fast_path.sql';
assert.ok(fs.existsSync(pennyPath), 'Penny no-change fast-path migration is missing');
const pennySql = fs.readFileSync(pennyPath, 'utf8');

for (const token of [
  'private.penny_structured_html_matches_published_set',
  "coalesce(o.metadata->>'source_signature','')=p_signature",
  "o.old_price is not distinct from p.old_price",
  "li.status='published'",
  'li.product_count=v_count',
  'li.detected_valid_from=v_from',
  'li.detected_valid_to=v_to',
  "'no_changes',true",
  "health_status='ok'",
  'revoke all on function private.penny_structured_html_matches_published_set'
]) {
  assert.ok(pennySql.includes(token), `missing Penny no-change guard: ${token}`);
}

assert.match(pennySql, /private\.penny_structured_html_matches_published_set\([\s\S]*?\) then[\s\S]*?return jsonb_build_object\([\s\S]*?'no_changes',true/);
assert.ok(pennySql.indexOf('penny_structured_html_matches_published_set') < pennySql.indexOf("if v_existing_import is null then"), 'Penny fast path must execute before destructive republish branch');

console.log('public offer cache and Penny idempotence regression checks passed');
