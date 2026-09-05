import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-cold-sync.js' });

const helperStart = source.indexOf('  const norm =');
const helperEnd = source.indexOf('\n  async function loadOwnerSnapshot', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Cold-sync helpery nejdou izolovaně otestovat.');

const helpers = source.slice(helperStart, helperEnd);
const context = createContext({
  result:null,
  String,
  JSON,
  Array,
  Set,
  Map,
  Boolean,
  Number,
  Math,
  Date,
});

new Script(`
  const LIST_KEY = 'slevao-shopping-list-v1';
  const LEGACY_RECIPE_START = Date.parse('2026-09-03T08:15:00Z');
  const LEGACY_RECIPE_END = Date.parse('2026-09-03T09:00:00Z');
  const localStorage = { getItem(){ return '[]'; } };
  const db = { rpc(){ throw new Error('RPC se v helper testu nesmí volat'); } };
  ${helpers}

  const manual = {
    local_id:'manual-eggs',
    server_id:'old-manual-eggs',
    source:'manual',
    custom_name:'Vejce (3 ks)',
    name:'Vejce (3 ks)',
    quantity:1,
    unit:'ks',
    completed:false
  };
  const remoteRecipe = {
    id:'remote-recipe-eggs',
    product_id:null,
    custom_name:'Vejce (3 ks)',
    quantity:1,
    unit:'ks',
    is_completed:false,
    is_recipe:true,
    recipe_ids:['rizek'],
    updated_at:'2026-09-05T12:00:00Z'
  };

  const manualCopy = { ...manual };
  const manualAdopted = adoptRecipeRemote(manualCopy, remoteRecipe);
  const hydratedRows = [{ ...manual }];
  const hydration = hydrateRemoteRecipeRows(hydratedRows, [remoteRecipe]);

  const staleManualAgainstRecipe = reconcileBeforeMerge([{ ...manual }], [remoteRecipe]);
  const staleRecipeAgainstRecipe = reconcileBeforeMerge([{
    local_id:'local-recipe-eggs',
    server_id:'old-recipe-eggs',
    source:'recipe',
    recipe_id:'rizek',
    recipe_ids:['rizek'],
    custom_name:'Vejce (3 ks)',
    name:'Vejce (3 ks)',
    quantity:1,
    unit:'ks',
    completed:false
  }], [remoteRecipe]);
  const staleRecipeAgainstManual = reconcileBeforeMerge([{
    local_id:'local-recipe-eggs-2',
    server_id:'old-recipe-eggs-2',
    source:'recipe',
    recipe_id:'rizek',
    recipe_ids:['rizek'],
    custom_name:'Vejce (3 ks)',
    name:'Vejce (3 ks)',
    quantity:1,
    unit:'ks',
    completed:false
  }], [{
    id:'remote-manual-eggs',
    product_id:null,
    custom_name:'Vejce (3 ks)',
    quantity:2,
    unit:'ks',
    is_completed:false,
    is_recipe:false
  }]);

  globalThis.result = {
    manualAdopted,
    manualCopy,
    hydration,
    hydratedRows,
    staleManualAgainstRecipe,
    staleRecipeAgainstRecipe,
    staleRecipeAgainstManual,
    manualIdentity:syncIdentityKey(manual),
    recipeIdentity:syncIdentityKey(remoteRecipe),
  };
`, { filename:'shopping-owner-recipe-manual-isolation-helpers.js' }).runInContext(context);

const result = context.result;
assert.equal(result.manualAdopted, false, 'Receptový cloud nesmí adoptovat ruční lokální položku.');
assert.equal(result.manualCopy.source, 'manual', 'Ruční položka se nesmí přepsat na recipe.');
assert.equal(result.manualCopy.server_id, 'old-manual-eggs', 'Ruční položka nesmí převzít ID receptového řádku.');

assert.equal(result.hydration.changed, true, 'Cloudový recept musí být při kolizi přidán jako samostatný řádek.');
assert.equal(result.hydration.added, 1, 'Kolize manual + recipe musí přidat právě jeden receptový řádek.');
assert.equal(result.hydration.adopted, 0, 'Při kolizi s ruční položkou nesmí dojít k adopci.');
assert.equal(result.hydratedRows.length, 2, 'Ruční a receptová položka se stejným názvem musí zůstat dva řádky.');
const hydratedManual = result.hydratedRows.find((row) => row.local_id === 'manual-eggs');
const hydratedRecipe = result.hydratedRows.find((row) => row.source === 'recipe');
assert.ok(hydratedManual, 'Původní ruční řádek zmizel během hydratace.');
assert.ok(hydratedRecipe, 'Cloudový receptový řádek nebyl vytvořen.');
assert.equal(hydratedManual.server_id, 'old-manual-eggs');
assert.equal(hydratedRecipe.server_id, 'remote-recipe-eggs');
assert.deepEqual(Array.from(hydratedRecipe.recipe_ids), ['rizek']);

assert.equal(result.staleManualAgainstRecipe.length, 0,
  'Smazaná ruční položka se nesmí zachránit jen existencí receptu stejného názvu.');
assert.equal(result.staleRecipeAgainstRecipe.length, 1,
  'Znovu přidaný recept stejného názvu se má rozpoznat jako stejný recipe typ.');
assert.equal(result.staleRecipeAgainstManual.length, 0,
  'Smazaný recept se nesmí zachránit jen existencí ruční položky stejného názvu.');

assert.equal(result.manualIdentity, 'manual:c:vejce 3 ks');
assert.equal(result.recipeIdentity, 'recipe:c:vejce 3 ks');
assert.notEqual(result.manualIdentity, result.recipeIdentity, 'Manual a recipe musí mít odlišnou sync identitu.');

for (const needle of [
  'function isRecipeRow(row)',
  'function syncIdentityKey(row)',
  ".filter((row) => isRecipeRow(row))",
  "return `${isRecipeRow(row) ? 'recipe' : 'manual'}:${key}`;",
  'const remoteKeys = new Set((remoteRows || []).map(syncIdentityKey).filter(Boolean));',
  'const key = syncIdentityKey(row);',
  'if (!row || !isRecipeRow(row) || !remote?.id) return false;',
]) assert.ok(source.includes(needle), `Chybí provenance isolation kontrakt: ${needle}`);

console.log('Shopping owner cold sync keeps manual and recipe rows isolated by provenance');
