import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/product-price-history-safe.js', root), 'utf8');
new Script(source, { filename:'assets/product-price-history-safe.js' });

const productId = 'a240dcd4-023b-4cc4-8c76-3ea345f23f03';
let client = null;
const rpcCalls = [];
const normalFromCalls = [];

const api = {
  getClient() { return client; },
};
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

assert.equal(window.__slevaoSafePriceHistory?.status, 'lazy', 'Adapter se má umět inicializovat i když klient při bootu ještě není dostupný.');
assert.equal(typeof window.SlevaoPriceHistorySafe?.load, 'function', 'Chybí přímé bezpečné API pro historii cen.');

client = {
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

const patched = api.getClient();
assert.equal(patched, client, 'Lazy getClient wrapper nevrací původní Supabase klient.');
assert.equal(client.__slevaoSafePriceHistoryInstalled, true, 'Klient se po pozdním načtení nepatchnul.');

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

console.log('Product price history adapter survives late client init and always routes history through safe RPC');
