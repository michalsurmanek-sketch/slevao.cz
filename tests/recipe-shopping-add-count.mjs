import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-recipes.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
new Script(source, { filename:'assets/home-recipes.js' });

assert.ok(index.includes('assets/home-recipes.js?v=20260904-1'), 'Homepage musí načítat jedinou externí implementaci receptů.');
assert.ok(!index.includes('const RECIPES = {'), 'index.html už nesmí obsahovat druhou inline kopii receptové logiky.');

function createScenario(initialRows = [], recipeKeys = ['spagety']) {
  let stored = JSON.stringify(initialRows);
  let navUpdates = 0;
  const handlers = new Map();
  const buttons = recipeKeys.map((recipe) => ({
    dataset:{ recipe },
    textContent:'Přidat suroviny',
    classList:{ add() {}, remove() {} },
    addEventListener(type, handler) {
      if (type === 'click') handlers.set(recipe, handler);
    }
  }));

  const sandbox = createContext({
    localStorage:{
      getItem(key) { return key === 'slevao-shopping-list-v1' ? stored : null; },
      setItem(key, value) { if (key === 'slevao-shopping-list-v1') stored = String(value); }
    },
    document:{
      querySelectorAll(selector) {
        return selector === '#recipesSection [data-recipe]' ? buttons : [];
      }
    },
    window:{ SlevaoPublic:{ updateNavCount(){ navUpdates += 1; } } },
    crypto:{ randomUUID: (() => { let n = 0; return () => `row-${++n}`; })() },
    setTimeout() {},
    Date,
    Math,
    String,
    JSON,
    Array,
    Map,
    Set,
    Number,
  });

  new Script(source, { filename:'assets/home-recipes.js' }).runInContext(sandbox);
  return {
    click(recipe) {
      const handler = handlers.get(recipe);
      assert.equal(typeof handler, 'function', `Recipe button ${recipe} nemá click handler.`);
      handler();
    },
    rows() { return JSON.parse(stored); },
    navUpdates() { return navUpdates; }
  };
}

const single = createScenario([], ['spagety']);
single.click('spagety');
let rows = single.rows();
assert.equal(rows.length, 8, 'Špagety musí přidat přesně osm samostatných surovin.');
assert.equal(new Set(rows.map((row) => row.local_id)).size, 8, 'Každá surovina musí mít vlastní řádek.');
assert.equal(new Set(rows.map((row) => row.custom_name)).size, 8, 'Suroviny se nesmí sloučit do jednoho množství.');
for (const row of rows) {
  assert.equal(row.quantity, 1, `Interní quantity musí být 1 pro ${row.custom_name}.`);
  assert.equal(row.qty, 1, `Interní qty musí být 1 pro ${row.custom_name}.`);
  assert.equal(row.unit, 'ks', `Interní jednotka musí být ks pro ${row.custom_name}.`);
  assert.equal(row.source, 'recipe', `Chybí recipe provenance pro ${row.custom_name}.`);
  assert.equal(row.recipe_id, 'spagety', `Chybí recipe_id pro ${row.custom_name}.`);
  assert.deepEqual(row.recipe_ids, ['spagety'], `Chybí recipe_ids pro ${row.custom_name}.`);
}
assert.ok(rows.some((row) => row.custom_name === 'Mleté hovězí maso (500 g)'), '500 g musí zůstat v popisku, ne v piece quantity.');
assert.equal(single.navUpdates(), 1, 'Po přidání receptu se má aktualizovat počet položek právě jednou.');

single.click('spagety');
rows = single.rows();
assert.equal(rows.length, 8, 'Druhý klik nesmí stejné suroviny duplikovat.');
assert.equal(single.navUpdates(), 2, 'Navigace se má přepočítat i po opakovaném kliknutí.');

const overlap = createScenario([], ['rizek','palacinky']);
overlap.click('rizek');
overlap.click('palacinky');
rows = overlap.rows();
assert.equal(rows.length, 11, 'Řízek a palačinky mají vytvořit 11 samostatných řádků, protože stejné názvy mají jiné potřebné množství.');
assert.ok(rows.some((row) => row.custom_name === 'Vejce (3 ks)'), 'Vejce pro řízek musí zůstat 3 ks.');
assert.ok(rows.some((row) => row.custom_name === 'Vejce (2 ks)'), 'Vejce pro palačinky musí zůstat 2 ks.');
assert.ok(rows.some((row) => row.custom_name === 'Hladká mouka (1 balení)'), 'Mouka pro řízek musí zůstat samostatná.');
assert.ok(rows.some((row) => row.custom_name === 'Hladká mouka (250 g)'), 'Mouka pro palačinky musí zůstat samostatná.');
for (const row of rows) {
  assert.equal(row.quantity, 1, `Ani při více receptech nesmí být display množství v quantity: ${row.custom_name}.`);
  assert.equal(row.unit, 'ks', `Ani při více receptech nesmí být měrná jednotka interní quantity: ${row.custom_name}.`);
}

const shared = createScenario([{
  local_id:'shared-existing',
  key:'c:spagety 1 baleni',
  product_id:null,
  custom_name:'Špagety (1 balení)',
  name:'Špagety (1 balení)',
  quantity:1,
  qty:1,
  unit:'ks',
  completed:false,
  source:'recipe',
  recipe_id:'meal-plan',
  recipe_ids:['meal-plan'],
  added_at:'2026-09-04T10:00:00.000Z'
}], ['spagety']);
shared.click('spagety');
rows = shared.rows();
assert.equal(rows.length, 8, 'Stejná receptová položka se nesmí duplikovat, jen propojit s dalším receptem.');
const sharedSpaghetti = rows.find((row) => row.local_id === 'shared-existing');
assert.deepEqual(sharedSpaghetti.recipe_ids, ['meal-plan','spagety'], 'Stejná položka musí zachovat vazbu na oba recepty.');
assert.equal(sharedSpaghetti.recipe_dirty, 1, 'Změna recipe provenance se musí označit pro cloudovou synchronizaci.');

console.log('recipe add count and cross-recipe provenance: OK');
