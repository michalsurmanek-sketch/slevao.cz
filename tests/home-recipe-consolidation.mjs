import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-filter-range-guard.js', root), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Chybí sekce ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `Chybí konec sekce ${end}`);
  return source.slice(from, to);
}

const helpers = section(
  "  const normalizeRecipeName =",
  "\n\n  function createMutationId()"
);

const context = { String, Number, Math, Date, Set, Map, Array };
new Script(`${helpers}\nglobalThis.consolidate = consolidateRecipeRows;`, { filename:'recipe-consolidation-helpers.js' }).runInNewContext(context);
const consolidate = context.consolidate;
assert.equal(typeof consolidate, 'function');

const eggs = consolidate([
  { local_id:'e3', source:'recipe', recipe_id:'rizek', custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', quantity:1, unit:'ks', completed:false },
  { local_id:'e2', source:'recipe', recipe_id:'palacinky', custom_name:'Vejce (2 ks)', name:'Vejce (2 ks)', quantity:1, unit:'ks', completed:false },
]);
assert.equal(eggs.merged, 1);
assert.equal(eggs.rows.length, 1);
assert.equal(eggs.rows[0].custom_name, 'Vejce (5 ks)');
assert.equal(eggs.rows[0].quantity, 1, 'Sloučení receptu nesmí znovu použít množství seznamu jako počet kusů.');
assert.equal(eggs.rows[0].unit, 'ks');
assert.deepEqual(Array.from(eggs.rows[0].recipe_ids).sort(), ['palacinky','rizek']);

const onions = consolidate([
  { local_id:'c1', server_id:'server-cibule', source:'recipe', recipe_id:'spagety', custom_name:'Cibule (1 ks)', name:'Cibule (1 ks)', quantity:1, unit:'ks', completed:false },
  { local_id:'c4', source:'recipe', recipe_id:'gulas', custom_name:'Cibule (4 ks)', name:'Cibule (4 ks)', quantity:1, unit:'ks', completed:false },
]);
assert.equal(onions.merged, 1);
assert.equal(onions.rows.length, 1);
assert.equal(onions.rows[0].server_id, 'server-cibule', 'Slučování musí zachovat už potvrzený cloudový řádek.');
assert.equal(onions.rows[0].custom_name, 'Cibule (5 ks)');
assert.equal(onions.rows[0].recipe_dirty, true, 'Přejmenovaný cloudový receptový řádek musí být označen k aktualizaci.');

const twoCloudGarlic = consolidate([
  { local_id:'g2', server_id:'server-g2', source:'recipe', recipe_id:'spagety', custom_name:'Česnek (2 stroužky)', name:'Česnek (2 stroužky)', completed:false },
  { local_id:'g3', server_id:'server-g3', source:'recipe', recipe_id:'gulas', custom_name:'Česnek (3 stroužky)', name:'Česnek (3 stroužky)', completed:false },
]);
assert.equal(twoCloudGarlic.merged, 0, 'Dvě už existující cloudové položky se nesmí destruktivně slučovat na homepage.');
assert.equal(twoCloudGarlic.rows.length, 2);

const manualAndRecipe = consolidate([
  { local_id:'manual', source:'manual', custom_name:'Vejce (2 ks)', name:'Vejce (2 ks)', completed:false },
  { local_id:'recipe', source:'recipe', recipe_id:'rizek', custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', completed:false },
]);
assert.equal(manualAndRecipe.merged, 0, 'Ruční položka uživatele se nesmí sloučit s receptovou položkou.');
assert.equal(manualAndRecipe.rows.length, 2);

const incompatibleFlour = consolidate([
  { local_id:'f1', source:'recipe', recipe_id:'rizek', custom_name:'Hladká mouka (1 balení)', name:'Hladká mouka (1 balení)', completed:false },
  { local_id:'f2', source:'recipe', recipe_id:'palacinky', custom_name:'Hladká mouka (250 g)', name:'Hladká mouka (250 g)', completed:false },
]);
assert.equal(incompatibleFlour.merged, 0, 'Nekompatibilní receptové jednotky se nesmí sčítat.');
assert.equal(incompatibleFlour.rows.length, 2);

const sync = section('  async function syncPendingRecipeRows()', '\n\n  function runOriginalRecipeAdd');
const consolidatePos = sync.indexOf('const consolidated = consolidateRecipeRows');
const dbPos = sync.indexOf('const db = await api.getSupabase();');
const sessionPos = sync.indexOf('db.auth.getSession()');
assert.ok(consolidatePos >= 0 && dbPos > consolidatePos && sessionPos > dbPos,
  'Lokální slučování musí proběhnout před Supabase/session kontrolou, aby fungovalo i hostům.');
assert.match(sync, /if \(consolidated\.merged > 0\) api\.writeList\?\.\(rows\);[\s\S]*?if \(!db\) return \{ synced:0, localOnly:true, merged:consolidated\.merged \};/,
  'Host bez dostupného Supabase musí dostat už sloučený lokální seznam.');
assert.match(sync, /if \(!session\?\.user\?\.id\) return \{ synced:0, localOnly:true, merged:consolidated\.merged \};/,
  'Nepřihlášený host musí zachovat informaci o provedeném sloučení.');

for (const needle of [
  "const dirty = rows.filter((row) => (",
  "row?.source === 'recipe'",
  '&& row?.server_id',
  '&& row?.recipe_dirty',
  ".update({ custom_name:name, quantity:1, unit:'ks', is_completed:false })",
  ".eq('id', row.server_id)",
  ".eq('shopping_list_id', listId)",
  ".is('product_id', null)",
  'alignRecipeRow(row, updated);',
]) {
  assert.ok(source.includes(needle), `Chybí bezpečný cloud update sloučené receptové položky: ${needle}`);
}

console.log('Compatible recipe ingredient consolidation is safe for guests and cloud-aware: OK');
