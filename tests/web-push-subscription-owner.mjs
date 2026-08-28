import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260828142711_make_web_push_subscription_owner_immutable.sql', root), 'utf8');
const edge = readFileSync(new URL('supabase/functions/web-push/index.ts', root), 'utf8');

for (const needle of [
  'create or replace function public.guard_web_push_subscription_owner()',
  'new.user_id is distinct from old.user_id',
  "errcode = '42501'",
  'revoke all on function public.guard_web_push_subscription_owner() from public, anon, authenticated;',
  'create trigger guard_web_push_subscription_owner_trg',
  'before update of user_id on public.web_push_subscriptions',
]) {
  assert.ok(migration.includes(needle), `Chybí immutable Web Push owner guard: ${needle}`);
}

assert.ok(edge.includes(".eq('endpoint', subscription.endpoint)"), 'Subscribe flow nekontroluje existující endpoint.');
assert.ok(edge.includes("String(existing.user_id) !== String(user.id)"), 'Subscribe flow nekontroluje vlastníka existujícího endpointu.');
assert.ok(edge.includes("Push endpoint už je přiřazen jinému účtu."), 'Subscribe flow nemá explicitní odmítnutí cizího endpointu.');
assert.ok(edge.includes("{ onConflict: 'endpoint' }"), 'Test musí hlídat DB guard proti endpoint upsert race.');

console.log('Web Push subscription ownership is immutable across endpoint races');
