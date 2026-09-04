import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-recipes.js', root), 'utf8');
new Script(source, { filename:'assets/home-recipes.js' });

let stored = '[]';
let clickHandler = null;
let navUpdates = 0;
const button = {
  dataset:{ recipe:'spagety' },
  textContent:'Přidat suroviny',
  classList:{ add() {}, remove() {} },
  addEventListener(type, handler) {
    if (type === 'click') clickHandler = handler;
  }
};

const sandbox = createContext({
  localStorage:{
    getItem(key) { return key === 'slevao-shopping-list-v1' ? stored : null; },
    setItem(key, value) { if (key === 'slevao-shopping-list-v1') stored = String(value); }
  },
  document:{
    querySelectorAll(selector) {
      return selector === '#recipesSection [data-recipe]' ? [button] : [];
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
  Number,
});

new Script(source, { filename:'assets/home-recipes.js' }).runInContext(sandbox);
assert.equal(typeof clickHandler, 'function', 'Recipe button nemá click handler.');

clickHandler();
let rows = JSON.parse(stored);
assert.equal(rows.length, 8, 'Špagety musí přidat přesně osm samostatných surovin.');
assert.equal(new Set(rows.map((row) => row.local_id)).size, 8, 'Každá surovina musí mít vlastní řádek.');
assert.equal(new Set(rows.map((row) => row.custom_name)).size, 8, 'Suroviny se nesmí sloučit do jednoho množství.');
for (const row of rows) {
  assert.equal(row.quantity, 1, `Interní quantity musí být 1 pro ${row.custom_name}.`);
  assert.equal(row.qty, 1, `Interní qty musí být 1 pro ${row.custom_name}.`);
  assert.equal(row.unit, 'ks', `Interní jednotka musí být ks pro ${row.custom_name}.`);
  assert.equal(row.source, 'recipe', `Chybí recipe provenance pro ${row.custom_name}.`);
  assert.equal(row.recipe_id, 'spagety', `Chybí recipe_id pro ${row.custom_name}.`);
}
assert.ok(rows.some((row) => row.custom_name === 'Mleté hovězí maso (500 g)'), '500 g musí zůstat v popisku, ne v piece quantity.');
assert.equal(navUpdates, 1, 'Po přidání receptu se má aktualizovat počet položek právě jednou.');

clickHandler();
rows = JSON.parse(stored);
assert.equal(rows.length, 8, 'Druhý klik nesmí stejné suroviny duplikovat.');
assert.equal(navUpdates, 2, 'Navigace se má přepočítat i po opakovaném kliknutí.');

console.log('recipe add count: OK');
