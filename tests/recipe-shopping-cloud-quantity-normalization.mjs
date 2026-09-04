import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-cold-sync.js' });

const helperStart = source.indexOf('  const norm =');
const helperEnd = source.indexOf('\n  async function sync(userId)', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Cold-sync recipe helpers nejdou izolovat.');
const helpers = source.slice(helperStart, helperEnd);

const sandbox = { result:null };
new Script(`
  const LEGACY_RECIPE_START = Date.parse('2026-09-03T08:15:00Z');
  const LEGACY_RECIPE_END = Date.parse('2026-09-03T09:00:00Z');
  const LIST_KEY = 'slevao-shopping-list-v1';
  const localStorage = { getItem(){ return '[]'; } };
  ${helpers}
  globalThis.result = {
    generic: legacyRecipeRepair({
      id:'remote-yogurt', product_id:null, custom_name:'Řecký jogurt', quantity:250, unit:'g',
      is_recipe:true, recipe_ids:['tzatziki'], created_at:'2026-09-04T12:00:00Z'
    }),
    labeled: legacyRecipeRepair({
      id:'remote-milk', product_id:null, custom_name:'Mléko (500 ml)', quantity:500, unit:'ks',
      is_recipe:true, recipe_ids:['palacinky'], created_at:'2026-09-04T12:00:00Z'
    }),
    semantic: legacyRecipeRepair({
      id:'remote-cherry', product_id:null, custom_name:'Rajčata (cherry)', quantity:500, unit:'ks',
      is_recipe:true, created_at:'2026-09-04T12:00:00Z'
    }),
    manual: legacyRecipeRepair({
      id:'manual-milk', product_id:null, custom_name:'Mléko', quantity:500, unit:'ml',
      is_recipe:false, created_at:'2026-09-04T12:00:00Z'
    }),
    legacy: legacyRecipeRepair({
      id:'legacy-chicken', product_id:null, custom_name:'Kuřecí prsa', quantity:600, unit:'g',
      is_recipe:false, created_at:'2026-09-03T08:21:39.148Z'
    })
  };
`, { filename:'recipe-shopping-cloud-quantity-helpers.js' }).runInNewContext(sandbox);

assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.result.generic)),
  { custom_name:'Řecký jogurt (250 g)', quantity:1, unit:'ks' },
  'Cloud recipe rows must normalize arbitrary structured amounts, not only hard-coded recipes.'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.result.labeled)),
  { custom_name:'Mléko (500 ml)', quantity:1, unit:'ks' },
  'A preserved recipe label must win over a corrupt internal piece quantity.'
);
assert.equal(sandbox.result.semantic, null, 'Semantic parentheses must not be rewritten as an amount.');
assert.equal(sandbox.result.manual, null, 'Manual rows outside the legacy window must remain untouched.');
assert.deepEqual(
  JSON.parse(JSON.stringify(sandbox.result.legacy)),
  { custom_name:'Kuřecí prsa (600 g)', quantity:1, unit:'ks' },
  'Known legacy rows from the affected rollout window must still be repaired.'
);
assert.ok(source.includes('p_recipe_ids: recipeSources(row)'), 'Cloud repair must preserve recipe provenance.');
assert.ok(!source.includes('p_recipe_ids: [],'), 'Cloud recipe repair must not discard recipe_ids.');

console.log('recipe cloud quantity normalization: OK');
