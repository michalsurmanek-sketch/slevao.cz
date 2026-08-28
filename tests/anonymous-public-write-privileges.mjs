import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260828144001_minimize_anon_public_table_write_grants.sql', root), 'utf8');

assert.ok(
  migration.includes('revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;'),
  'Anonymní role nemá globálně stažené write privilege v public schématu.'
);
assert.ok(
  migration.includes('grant insert on table public.offer_reports to anon;'),
  'Veřejné hlášení chybné nabídky přišlo o jediný záměrný anonymní write grant.'
);
assert.ok(!/grant\s+(?:update|delete|truncate|references|trigger)/i.test(migration), 'Migration vrací anonymní roli nebezpečný write grant.');
assert.ok(!/revoke\s+select/i.test(migration), 'Migration nesmí měnit veřejný SELECT.');

console.log('Anonymous public-table writes are minimized to offer_reports INSERT');
