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

console.log('public offer cache dirty refresh regression checks passed');
