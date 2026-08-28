import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828170238_debounce_public_offer_search_cache_refresh.sql', root),
  'utf8',
);

for (const needle of [
  "v_settle_window interval := interval '2 minutes';",
  "v_max_staleness interval := interval '15 minutes';",
  "pg_try_advisory_xact_lock(hashtextextended('slevao:public_offer_search_cache_refresh', 0))",
  'and v_last_change_at > v_now - v_settle_window',
  'and v_last_refresh_at > v_now - v_max_staleness',
  "'reason', 'settling'",
  "'settle_seconds', extract(epoch from v_settle_window)::integer",
  "'max_staleness_seconds', extract(epoch from v_max_staleness)::integer",
  "'force_refresh_at', v_last_refresh_at + v_max_staleness",
  'refresh materialized view concurrently private.public_offer_search_cache;',
]) {
  assert.ok(migration.includes(needle), `Chybí cache-refresh debounce kontrakt: ${needle}`);
}

const settleIf = migration.indexOf('if not p_force\n     and v_dirty_count > 0');
const refreshPos = migration.indexOf('refresh materialized view concurrently private.public_offer_search_cache;');
assert.ok(settleIf >= 0 && refreshPos > settleIf, 'Settling guard musí proběhnout před drahým materialized-view refreshem.');
assert.ok(
  migration.includes("if v_dirty_count = 0 and not p_force then"),
  'Čistá cache musí dál přeskočit refresh bez ohledu na debounce.',
);
assert.ok(
  !migration.includes('cron.schedule') && !migration.includes('cron.unschedule'),
  'Debounce migration nesmí měnit 5min cron; optimalizace patří do serverového guardu.',
);

console.log('Public offer search-cache refresh debounce OK (2m settle / 15m max staleness)');
