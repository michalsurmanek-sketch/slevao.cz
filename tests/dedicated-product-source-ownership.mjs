import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260827105516_mark_verified_product_sources_dedicated.sql', root),
  'utf8',
);
const discovery = readFileSync(new URL('supabase/functions/discover-leaflets/index.ts', root), 'utf8');

const expected = new Map([
  ['asko', 'asko-official-clearance-html-v2'],
  ['auto-kelly', 'auto-kelly-marketing-deals-v1'],
  ['ca', 'ca-official-sale-v1'],
  ['cropp', 'cropp-official-clearance-v1'],
  ['dek', 'dek-official-action-html-v1'],
  ['house', 'house-official-clearance-v1'],
  ['ikea', 'ikea-official-lower-price-v1'],
  ['petcenter', 'petcenter-official-clearance-html-v1'],
  ['reserved', 'reserved-official-clearance-v1'],
  ['rohlik', 'rohlik-price-hits-html-v1'],
  ['sinsay', 'sinsay-official-clearance-v1'],
  ['takko', 'takko-official-sale-html-v2'],
]);

assert.match(migration, /set automation_mode = 'dedicated'/i);
assert.match(migration, /ls\.automation_mode = 'automatic'/i, 'Migrace smí přebírat jen dosud generic-owned zdroje.');
assert.match(migration, /ls\.is_active is true/i, 'Migrace smí měnit jen aktivní zdroj.');
assert.match(migration, /ls\.adapter_key = d\.adapter_key/i, 'Převod musí být svázaný s přesným adapter_key.');
assert.match(migration, /ilike 'Adaptér generic %'/i, 'Smí se čistit pouze chyba vytvořená generic adaptérem.');
assert.match(migration, /status in \('review', 'queued', 'downloading', 'processing', 'publishing'\)/i);
assert.match(migration, /coalesce\(li\.metadata->>'adapter', 'generic'\) = 'generic'/i, 'Archivace nesmí sáhnout na dedikované importy.');
assert.doesNotMatch(migration, /delete\s+from\s+public\.leaflet_/i, 'Převod vlastníka nesmí mazat data.');

for (const [slug, adapter] of expected) {
  assert.ok(migration.includes(`('${slug}', '${adapter}')`), `Chybí přesný dedicated kontrakt pro ${slug}.`);
}

assert.match(
  discovery,
  /String\(source\.automation_mode \|\| ''\)\.toLocaleLowerCase\('cs'\) === 'automatic'/,
  'Generic discovery musí nadále přijímat jen automation_mode=automatic.',
);

console.log('Dedicated product source ownership OK');
