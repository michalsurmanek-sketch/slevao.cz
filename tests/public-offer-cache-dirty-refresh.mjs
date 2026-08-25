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
