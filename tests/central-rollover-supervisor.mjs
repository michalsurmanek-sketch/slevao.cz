import fs from 'node:fs';
import assert from 'node:assert/strict';

const path = 'supabase/migrations/20260825222000_central_rollover_supervisor.sql';
assert.ok(fs.existsSync(path), 'central rollover migration is missing');
const sql = fs.readFileSync(path, 'utf8');

for (const token of [
  'private.rollover_sync_targets',
  'public.run_rollover_supervisor()',
  "'*/5 * * * *'",
  "'Europe/Prague'",
  "'daily_snapshot'",
  "'next_day_prefetch'",
  "'source_refresh'",
  "'penny'",
  "'billa'",
  "'flop'",
  "'terno'",
  "'jip'",
  "'coop'",
  "'kik'",
  "'action'",
  "'auto-kelly'",
  "'xxxlutz'",
  "'moebelix'",
  "'benu'",
  'last_triggered_at',
  'cooldown',
  'revoke all on function public.run_rollover_supervisor() from public, anon, authenticated',
  'grant execute on function public.run_rollover_supervisor() to service_role'
]) {
  assert.ok(sql.includes(token), `missing rollover guard: ${token}`);
}

assert.ok(!sql.includes("('tesco',"), 'Tesco must not be auto-published while its safe parser is upstream-blocked');
assert.ok(sql.includes("v_today_count < t.min_today_offers"), 'supervisor must react to missing current-day offers');
assert.ok(sql.includes("v_tomorrow_count < t.min_tomorrow_offers"), 'supervisor must react to missing next-day offers');
assert.ok(sql.includes("t.last_triggered_at > v_now - t.cooldown"), 'supervisor must throttle retries');

console.log('central rollover supervisor regression checks passed');
