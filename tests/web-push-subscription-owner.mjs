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

for (const needle of [
  ".eq('endpoint', subscription.endpoint)",
  'String(existing.user_id) !== String(user.id)',
  'Push endpoint už je přiřazen jinému účtu.',
  "{ onConflict: 'endpoint' }",
  "error.code === '42501'",
  '/Vlastníka push subscription nelze změnit/i',
  "return json({ error: 'Push endpoint už je přiřazen jinému účtu.' }, 409);",
]) {
  assert.ok(edge.includes(needle), `Chybí Web Push ownership race handling: ${needle}`);
}

const upsertIndex = edge.indexOf("{ onConflict: 'endpoint' }");
const raceCodeIndex = edge.indexOf("error.code === '42501'", upsertIndex);
const conflictResponseIndex = edge.indexOf("return json({ error: 'Push endpoint už je přiřazen jinému účtu.' }, 409);", raceCodeIndex);
assert.ok(upsertIndex >= 0 && raceCodeIndex > upsertIndex, 'DB ownership conflict se nekontroluje po endpoint upsertu.');
assert.ok(conflictResponseIndex > raceCodeIndex, 'DB ownership conflict se nepřekládá na HTTP 409.');

console.log('Web Push subscription ownership is immutable and endpoint races return 409');
