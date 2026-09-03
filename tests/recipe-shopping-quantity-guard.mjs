import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const homeSource = readFileSync(new URL('assets/home-recipes.js', root), 'utf8');
const guardSource = readFileSync(new URL('assets/shopping-recipe-quantity-guard.js', root), 'utf8');
const listHtml = readFileSync(new URL('seznam.html', root), 'utf8');

new Script(homeSource, { filename:'assets/home-recipes.js' });
new Script(guardSource, { filename:'assets/shopping-recipe-quantity-guard.js' });

assert.match(homeSource, /LEGACY_RECIPE_START = Date\.parse\('2026-09-03T08:15:00Z'\)/, 'Legacy migration must be bounded to the recipe rollout window.');
assert.match(homeSource, /LEGACY_RECIPE_END = Date\.parse\('2026-09-03T09:00:00Z'\)/, 'Legacy migration must have an explicit end time.');
assert.match(homeSource, /legacyRecipeRows = new Map\(/, 'Legacy migration must require an exact recipe name/quantity/unit signature.');
assert.doesNotMatch(homeSource, /legacyRecipeNames = new Set/, 'Broad name-only recipe migration must never return.');
assert.match(homeSource, /source:'recipe',recipe_id:key/, 'New recipe rows must carry recipe provenance.');
assert.match(homeSource, /quantity:1,qty:1,unit:'ks'/, 'A recipe ingredient must count as one shopping-list row regardless of grams or millilitres.');

const initialRows = [
  {
    local_id:'legacy-recipe', product_id:null, custom_name:'Kuřecí prsa', name:'Kuřecí prsa',
    quantity:600, unit:'g', added_at:'2026-09-03T08:21:39.148Z'
  },
  {
    local_id:'manual-before', product_id:null, custom_name:'Cibule', name:'Cibule',
    quantity:4, unit:'ks', added_at:'2026-09-02T08:21:39.148Z'
  },
  {
    local_id:'manual-different-qty', product_id:null, custom_name:'Cibule', name:'Cibule',
    quantity:7, unit:'ks', added_at:'2026-09-03T08:22:00.000Z'
  }
];
let stored = JSON.stringify(initialRows);
const sandbox = {
  localStorage: {
    getItem(key) { return key === 'slevao-shopping-list-v1' ? stored : null; },
    setItem(key, value) { if (key === 'slevao-shopping-list-v1') stored = String(value); }
  },
  window: {}
};
new Script(guardSource).runInContext(createContext(sandbox));
const repaired = JSON.parse(stored);

assert.equal(repaired[0].custom_name, 'Kuřecí prsa (600 g)');
assert.equal(repaired[0].quantity, 1);
assert.equal(repaired[0].unit, 'ks');
assert.equal(repaired[0].source, 'recipe');
assert.equal(repaired[1].custom_name, 'Cibule', 'Manual items created before the rollout must remain untouched.');
assert.equal(repaired[1].quantity, 4);
assert.equal(repaired[2].custom_name, 'Cibule', 'Rows with a quantity that was never emitted by a recipe must remain untouched.');
assert.equal(repaired[2].quantity, 7);
assert.equal(sandbox.window.__slevaoRecipeQuantityGuard?.repaired, 1);

const guardPos = listHtml.indexOf('assets/shopping-recipe-quantity-guard.js');
const bootstrapPos = listHtml.indexOf('assets/shopping-insights-bootstrap.js');
assert.ok(guardPos >= 0, 'Shopping-list page must load the recipe quantity guard.');
assert.ok(bootstrapPos > guardPos, 'Recipe quantity guard must run before shopping-list bootstrap and cloud synchronization.');

console.log('recipe shopping quantity regression guard: OK');
