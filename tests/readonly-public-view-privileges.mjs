import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260828143811_restrict_readonly_public_view_privileges.sql', root), 'utf8');
const views = [
  'active_offers',
  'localized_active_offers',
  'leaflet_source_health',
  'products_missing_images_priority',
  'public_store_feed_health',
];

for (const view of views) {
  const expected = `revoke insert, update, delete, truncate, references, trigger on public.${view} from anon, authenticated;`;
  assert.ok(migration.includes(expected), `Chybí read-only ACL guard pro ${view}.`);
}

assert.ok(!/revoke\s+select/i.test(migration), 'Read-only view hardening nesmí odebrat veřejný SELECT.');
assert.ok(!/from\s+service_role/i.test(migration), 'Read-only view hardening nemá měnit service-role oprávnění.');
assert.ok(!/drop\s+view|create\s+(?:or\s+replace\s+)?view|alter\s+view/i.test(migration), 'ACL hardening nesmí měnit definice view.');

console.log('Read-only public views expose SELECT only to public client roles');
