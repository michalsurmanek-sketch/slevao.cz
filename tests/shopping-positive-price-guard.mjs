import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-positive-price-guard.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-positive-price-guard.js' });

const selectCalls = [];
const rpcCalls = [];
const otherQuery = {
  select() { return { marker:'other-select' }; }
};

const db = {
  from(table) {
    if (table !== 'offers') return otherQuery;
    return {
      select(...args) {
        selectCalls.push(args);
        return {
          filters: [],
          gt(field, value) {
            this.filters.push([field, value]);
            return this;
          }
        };
      }
    };
  },
  rpc(name, args, options) {
    rpcCalls.push([name, args, options]);
    if (name === 'get_public_shopping_list_candidates') {
      return Promise.resolve({
        data: [
          { query_key:'milk', offer:{ id:'ok-object', price:12.9 } },
          { query_key:'bread', offer:'{"id":"ok-json","price":"4.50"}' },
          { query_key:'zero', offer:{ id:'zero', price:0 } },
          { query_key:'negative', offer:{ id:'negative', price:-5 } },
          { query_key:'nan', offer:{ id:'nan', price:'not-a-number' } },
          { query_key:'missing', offer:null }
        ],
        error:null
      });
    }
    return { passthrough:true, name };
  }
};

const context = createContext({
  window:{ SlevaoSupabase:{ getClient:() => db } },
  Number,
  JSON,
  Promise
});

new Script(source, { filename:'shopping-positive-price-guard-runtime.js' }).runInContext(context);
assert.equal(db.__slevaoPositivePriceGuard, true, 'Positive-price guard se nenainstaloval.');
assert.equal(context.window.SlevaoShoppingPositivePriceGuard.hasPositivePrice(1), true);
assert.equal(context.window.SlevaoShoppingPositivePriceGuard.hasPositivePrice('1.25'), true);
for (const invalid of [0, -1, '0', 'bad', NaN, Infinity, null, undefined]) {
  assert.equal(context.window.SlevaoShoppingPositivePriceGuard.hasPositivePrice(invalid), false, `Neplatná cena prošla guardem: ${String(invalid)}`);
}

const offerSelect = db.from('offers').select('id,price');
assert.deepEqual(offerSelect.filters, [['price', 0]], 'offers.select nedostal databázový filtr price > 0.');
assert.equal(selectCalls.length, 1, 'offers.select se provedl neočekávaně vícekrát.');
assert.deepEqual(db.from('shopping_lists').select('id'), { marker:'other-select' }, 'Guard zasáhl do jiné tabulky než offers.');

const candidates = await db.rpc('get_public_shopping_list_candidates', { p_queries:['milk'] });
assert.deepEqual(candidates.data.map((row) => row.query_key), ['milk', 'bread'], 'RPC kandidáti neodfiltrovali nulovou, zápornou nebo nečíselnou cenu.');
const passthrough = db.rpc('get_shared_shopping_list', { p_token:'x' });
assert.deepEqual(passthrough, { passthrough:true, name:'get_shared_shopping_list' }, 'Guard změnil nesouvisející RPC.');

const guardedFrom = db.from;
const guardedRpc = db.rpc;
new Script(source, { filename:'shopping-positive-price-guard-second-install.js' }).runInContext(context);
assert.equal(db.from, guardedFrom, 'Druhá instalace znovu obalila db.from.');
assert.equal(db.rpc, guardedRpc, 'Druhá instalace znovu obalila db.rpc.');

for (const needle of [
  "table !== 'offers'",
  "selected.gt('price', 0)",
  "name !== 'get_public_shopping_list_candidates'",
  'Number.isFinite(price) && price > 0',
]) assert.ok(source.includes(needle), `Chybí positive-price kontrakt: ${needle}`);

const guardUrl = html.match(/assets\/shopping-positive-price-guard\.js\?v=[^"']+/)?.[0] || '';
assert.match(guardUrl, /^assets\/shopping-positive-price-guard\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný positive-price guard.');
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.ok(bootstrapUrl, 'seznam.html nemá shopping insights bootstrap.');
assert.ok(html.indexOf(guardUrl) < html.indexOf(bootstrapUrl), 'Positive-price guard se musí načíst před shopping bootstrapem.');
assert.ok(worker.includes(`'/${guardUrl}'`), 'PWA necachuje přesný positive-price guard ze seznam.html.');

console.log('Shopping positive-price guard filters offers and custom candidates before optimizer/insights runtime');
