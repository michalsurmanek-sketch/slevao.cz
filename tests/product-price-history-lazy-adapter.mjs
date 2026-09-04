import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/product-price-history-safe.js', root), 'utf8');
new Script(source, { filename:'assets/product-price-history-safe.js' });
assert.doesNotMatch(source, /api\.getClient\s*=/, 'Price-history adapter nesmí přepisovat frozen SlevaoSupabase.getClient.');
assert.doesNotMatch(source, /SlevaoSupabase\.getClient\s*=/, 'Price-history adapter nesmí přepisovat frozen veřejné API.');

const productId = 'a240dcd4-023b-4cc4-8c76-3ea345f23f03';
const rpcCalls = [];
const normalFromCalls = [];
const client = {
  from(table) {
    normalFromCalls.push(table);
    return { table };
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    return {
      data:[{
        price:19.9,
        recorded_at:'2026-09-04T07:52:33.000Z',
        store_name:'Test Market',
        store_slug:'test-market',
        store_logo_url:'/logo.svg',
      }],
      error:null,
    };
  },
};
const api = Object.freeze({ getClient() { return client; } });
const window = { SlevaoSupabase:api };
new Script(source, { filename:'assets/product-price-history-safe.js' }).runInContext(createContext({
  window,
  console,
  WeakSet,
  Promise,
  Error,
  Number,
  String,
  Array,
  Object,
}));

assert.equal(window.__slevaoSafePriceHistory?.status, 'patched', 'Existující Supabase klient se má patchnout bez mutace frozen API.');
assert.equal(client.__slevaoSafePriceHistoryInstalled, true, 'Klient nemá bezpečný price-history adapter.');
assert.equal(typeof window.SlevaoPriceHistorySafe?.load, 'function', 'Chybí přímé bezpečné API pro historii cen.');
assert.equal(Object.isFrozen(window.SlevaoSupabase), true, 'Test musí skutečně používat frozen SlevaoSupabase API.');

const history = await client
  .from('price_history')
  .select('price,recorded_at,stores(name,slug,logo_url)')
  .eq('product_id', productId)
  .order('recorded_at')
  .limit(250);

assert.equal(history.error, null);
assert.equal(history.data.length, 1);
assert.equal(history.data[0].price, 19.9);
assert.deepEqual(history.data[0].stores, {
  name:'Test Market',
  slug:'test-market',
  logo_url:'/logo.svg',
});
assert.equal(rpcCalls.length, 1);
assert.equal(rpcCalls[0].name, 'get_public_product_price_history');
assert.deepEqual(rpcCalls[0].args, { p_product_id:productId, p_limit:250 });
assert.equal(normalFromCalls.length, 0, 'price_history nesmí spadnout zpět na přímé čtení tabulky.');

const direct = await window.SlevaoPriceHistorySafe.load(productId, 1000);
assert.equal(direct.error, null);
assert.equal(direct.data[0].stores.name, 'Test Market');
assert.equal(rpcCalls.length, 2, 'Přímé API historie cen musí používat bezpečný RPC endpoint.');

const productsBuilder = client.from('products');
assert.equal(productsBuilder.table, 'products');
assert.deepEqual(normalFromCalls, ['products'], 'Ostatní tabulky musí dál používat původní Supabase from().');

// Late-client scenario: adapter may boot before getClient can return the singleton.
let lateClient = null;
const lateRpcCalls = [];
const lateApi = Object.freeze({ getClient() { return lateClient; } });
const lateWindow = { SlevaoSupabase:lateApi };
new Script(source, { filename:'assets/product-price-history-safe.js' }).runInContext(createContext({
  window:lateWindow,
  console,
  WeakSet,
  Promise,
  Error,
  Number,
  String,
  Array,
  Object,
}));
assert.equal(lateWindow.__slevaoSafePriceHistory?.status, 'lazy');
lateClient = {
  from(table) { return { table }; },
  async rpc(name, args) {
    lateRpcCalls.push({ name, args });
    return { data:[], error:null };
  },
};
const lateResult = await lateWindow.SlevaoPriceHistorySafe.load(productId, 50);
assert.equal(lateResult.error, null);
assert.equal(lateClient.__slevaoSafePriceHistoryInstalled, true, 'Přímé load() musí patchnout i klienta dostupného až po bootu.');
assert.equal(lateRpcCalls[0].name, 'get_public_product_price_history');
assert.deepEqual(lateRpcCalls[0].args, { p_product_id:productId, p_limit:50 });

console.log('Product price history adapter respects frozen API and always routes history through safe RPC');
