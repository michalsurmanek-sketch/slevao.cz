import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260823110613_preserve_product_sync_operational_health_states.sql', 'utf8');

assert(migration.includes('with (security_invoker=true)'), 'Product health view must remain security_invoker.');
assert(migration.includes("when active_offer_count>0 then 'ok'::text"), 'Current verified offers must keep a store user-visible healthy.');
for (const state of ['waiting_source','not_applicable','blocked','degraded','running']) {
  assert(migration.includes(`'${state}'`), `Product health view must preserve ${state}.`);
}
assert(migration.includes("when state_health_status='error' or last_error is not null then 'error'::text"), 'Real internal failures must remain errors.');
assert(migration.includes("effective_last_success_at < now()-interval '2 days'"), 'Unknown old syncs must still become stale.');
assert(migration.includes("o.status='published'"), 'Health counts must use published offers only.');
assert(migration.includes('o.is_verified=true'), 'Health counts must use verified offers only.');
assert(migration.includes("now() at time zone 'Europe/Prague'"), 'Health validity must use the Czech business date.');

console.log('Product sync operational health semantics OK');
