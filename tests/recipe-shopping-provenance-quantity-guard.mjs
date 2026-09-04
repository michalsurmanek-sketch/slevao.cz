import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-recipe-quantity-guard.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-recipe-quantity-guard.js' });

const initialRows = [
  {
    local_id:'legacy-window', product_id:null, custom_name:'Kuřecí prsa', name:'Kuřecí prsa',
    quantity:600, unit:'g', added_at:'2026-09-03T08:21:39.148Z'
  },
  {
    local_id:'manual-outside-window', product_id:null, custom_name:'Cibule', name:'Cibule',
    quantity:4, unit:'ks', added_at:'2026-09-02T08:21:39.148Z'
  },
  {
    local_id:'recipe-label-corrupt-quantity', product_id:null,
    custom_name:'Mléko (500 ml)', name:'Mléko (500 ml)', quantity:500, unit:'ks',
    source:'recipe', added_at:'2026-09-04T10:00:00.000Z'
  },
  {
    local_id:'recipe-plain-corrupt-quantity', product_id:null,
    custom_name:'Mléko', name:'Mléko', quantity:500, unit:'ml',
    recipe_id:'palacinky', added_at:'2026-09-04T10:00:00.000Z'
  },
  {
    local_id:'semantic-parentheses', product_id:null,
    custom_name:'Rajčata (cherry)', name:'Rajčata (cherry)', quantity:500, unit:'ks',
    source:'recipe', added_at:'2026-09-04T10:00:00.000Z'
  },
  {
    local_id:'manual-ml', product_id:null,
    custom_name:'Mléko', name:'Mléko', quantity:500, unit:'ml',
    added_at:'2026-09-04T10:00:00.000Z'
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
new Script(source).runInContext(createContext(sandbox));
const rows = JSON.parse(stored);

assert.equal(rows[0].custom_name, 'Kuřecí prsa (600 g)');
assert.equal(rows[0].quantity, 1);
assert.equal(rows[0].unit, 'ks');

assert.equal(rows[1].custom_name, 'Cibule');
assert.equal(rows[1].quantity, 4, 'Manual rows outside the legacy rollout window must stay untouched.');

assert.equal(rows[2].custom_name, 'Mléko (500 ml)');
assert.equal(rows[2].quantity, 1, 'Recipe display amount must never become shopping-list piece quantity.');
assert.equal(rows[2].unit, 'ks');

assert.equal(rows[3].custom_name, 'Mléko (500 ml)');
assert.equal(rows[3].quantity, 1, 'Provenance must repair old structured 500 ml recipe rows outside the rollout window.');
assert.equal(rows[3].unit, 'ks');

assert.equal(rows[4].custom_name, 'Rajčata (cherry)');
assert.equal(rows[4].quantity, 500, 'Semantic parentheses must not be mistaken for a recipe quantity suffix.');

assert.equal(rows[5].custom_name, 'Mléko');
assert.equal(rows[5].quantity, 500, 'Manual 500 ml rows without recipe provenance must remain untouched.');
assert.equal(rows[5].unit, 'ml');

assert.equal(sandbox.window.__slevaoRecipeQuantityGuard?.repaired, 3);
console.log('recipe provenance quantity guard: OK');
