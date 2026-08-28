import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260828142401_restrict_user_notification_updates_to_read_state.sql', root), 'utf8');
const account = readFileSync(new URL('assets/account.js', root), 'utf8');

for (const needle of [
  'create or replace function public.guard_notification_user_update()',
  'v_user_id uuid := auth.uid();',
  'if v_user_id is null or public.is_admin() then',
  "old.user_id is distinct from v_user_id",
  "new.user_id is distinct from v_user_id",
  "(to_jsonb(new) - 'is_read') is distinct from (to_jsonb(old) - 'is_read')",
  "errcode = '42501'",
  'revoke all on function public.guard_notification_user_update() from public, anon, authenticated;',
  'create trigger guard_notification_user_update_trg',
  'before update on public.notifications',
]) {
  assert.ok(migration.includes(needle), `Chybí notification integrity guard: ${needle}`);
}

const notificationUpdatePattern = /db\.from\('notifications'\)\s*\.update\(\{\s*is_read:\s*true\s*\}\)/g;
const readOnlyUpdates = account.match(notificationUpdatePattern) || [];
assert.equal(readOnlyUpdates.length, 2, 'Účet má mít přesně dvě klientské UPDATE operace notifikací a obě pouze pro is_read=true.');

const allNotificationUpdates = account.match(/db\.from\('notifications'\)\s*\.update\(/g) || [];
assert.equal(allNotificationUpdates.length, readOnlyUpdates.length, 'Klient účtu obsahuje širší UPDATE notifikací než změnu is_read.');

console.log('Account notification content integrity guard OK');
