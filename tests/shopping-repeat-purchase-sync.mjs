import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-repeat-purchase-sync.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828102937_repeat_shopping_purchase_atomic.sql', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-repeat-purchase-sync.js' });

for (const needle of [
  'create or replace function public.repeat_shopping_purchase(p_purchase_id uuid)',
  'security invoker',
  'v_user_id uuid := auth.uid();',
  'p.user_id = v_user_id',
  'sl.user_id = v_user_id',
  'sl.is_archived = false',
  'for update;',
  'update public.shopping_list_items',
  'quantity = shopping_list_items.quantity + v_quantity',
  'is_completed = false',
  'exception when unique_violation then',
  'revoke all on function public.repeat_shopping_purchase(uuid) from public;',
  'revoke all on function public.repeat_shopping_purchase(uuid) from anon;',
  'grant execute on function public.repeat_shopping_purchase(uuid) to authenticated;',
]) assert.ok(migration.toLowerCase().includes(needle.toLowerCase()), `Chybí repeat-purchase SQL kontrakt: ${needle}`);
assert.ok(!/security\s+definer/i.test(migration), 'Repeat purchase RPC nesmí obcházet RLS přes SECURITY DEFINER.');

const storage = new Map();
const rpcCalls = [];
const clickListeners = [];
const db = {
  rpc(name, args) {
    rpcCalls.push([name, args]);
    return Promise.resolve({ data:{ list_id:'list-1', item_count:2 }, error:null });
  },
  auth: {
    getSession() {
      return Promise.resolve({ data:{ session:null }, error:null });
    }
  }
};
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
const context = createContext({
  window:{
    SlevaoSupabase:{ getClient:() => db },
    SlevaoPublic:{ updateNavCount() {}, toast() {} },
    setTimeout() {}
  },
  document:{
    querySelector(selector) { return selector === '.sfListLayout' ? {} : null; },
    addEventListener(type, handler, capture) { clickListeners.push([type, handler, capture]); }
  },
  localStorage,
  crypto:{ randomUUID:() => 'new-row-id' },
  location:{ reload() {} },
  Date,
  Number,
  JSON,
  Promise,
  Map,
  String,
  Math,
  Error
});
new Script(source, { filename:'shopping-repeat-purchase-sync-runtime.js' }).runInContext(context);
const api = context.window.SlevaoRepeatPurchaseSync;
assert.ok(api, 'Repeat purchase bridge se nenainstaloval.');
assert.equal(clickListeners.length, 1, 'Repeat purchase bridge nemá přesně jeden click listener.');
assert.deepEqual([clickListeners[0][0], clickListeners[0][2]], ['click', true], 'Repeat purchase listener musí běžet v capture fázi.');
assert.ok(source.includes('event.stopImmediatePropagation();'), 'Bridge nezastaví původní history bubble handler.');
assert.ok(!source.includes("db.from('shopping_list_items')"), 'Bridge nesmí zapisovat cloudové položky mimo atomickou RPC.');

storage.set('slevao-shopping-list-v1', JSON.stringify([
  { local_id:'p-local', product_id:'product-1', quantity:2, unit:'ks', completed:true, name:'Mléko' },
  { local_id:'c-local', product_id:null, custom_name:'Chléb', name:'Chléb', quantity:1, unit:'ks', completed:false }
]));
const guestRows = api.repeatGuestPurchase({
  id:'local-purchase',
  items:[
    { product_id:'product-1', name:'Mléko', quantity:3, unit:'ks' },
    { product_id:null, custom_name:'chléb', name:'Chléb', quantity:2, unit:'ks' },
    { product_id:null, custom_name:'Vejce', name:'Vejce', quantity:2, unit:'ks' }
  ]
});
const product = guestRows.find((row) => row.product_id === 'product-1');
const bread = guestRows.find((row) => String(row.custom_name || '').toLowerCase() === 'chléb');
const eggs = guestRows.find((row) => String(row.custom_name || '').toLowerCase() === 'vejce');
assert.equal(product.quantity, 5, 'Guest repeat nenavýšil existující produktové množství.');
assert.equal(product.completed, false, 'Guest repeat nevrátil existující produkt mezi aktivní položky.');
assert.equal(bread.quantity, 3, 'Guest repeat nenavýšil existující vlastní položku.');
assert.equal(eggs.quantity, 2, 'Guest repeat nepřidal novou vlastní položku.');
assert.equal(JSON.parse(storage.get('slevao-shopping-list-v1')).length, 3, 'Guest repeat neuložil sloučený seznam.');

await api.repeatCloudPurchase('11111111-1111-1111-1111-111111111111');
assert.equal(rpcCalls.length, 1, 'Cloud repeat zavolal neočekávaný počet RPC.');
assert.deepEqual(rpcCalls[0], [
  'repeat_shopping_purchase',
  { p_purchase_id:'11111111-1111-1111-1111-111111111111' }
], 'Cloud repeat nepoužil atomickou repeat_shopping_purchase RPC.');

const assetUrl = html.match(/assets\/shopping-repeat-purchase-sync\.js\?v=[^"']+/)?.[0] || '';
assert.match(assetUrl, /^assets\/shopping-repeat-purchase-sync\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný repeat-purchase bridge.');
assert.ok(worker.includes(`'/${assetUrl}'`), 'PWA necachuje přesný repeat-purchase bridge ze seznam.html.');

console.log('Shopping repeat purchase uses atomic cloud RPC and preserves guest merge semantics');
