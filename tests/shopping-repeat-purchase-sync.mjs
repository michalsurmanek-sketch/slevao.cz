import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-repeat-purchase-sync.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828102937_repeat_shopping_purchase_atomic.sql', root), 'utf8');
const idempotentMigration = readFileSync(new URL('supabase/migrations/20260828121925_idempotent_repeat_shopping_purchase.sql', root), 'utf8');
const fallbackMigration = readFileSync(new URL('supabase/migrations/20260828125540_repeat_purchase_missing_product_fallback.sql', root), 'utf8');
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
]) assert.ok(migration.toLowerCase().includes(needle.toLowerCase()), `Chybí původní repeat-purchase SQL kontrakt: ${needle}`);
assert.ok(!/security\s+definer/i.test(migration), 'Původní repeat purchase RPC nesmí obcházet RLS přes SECURITY DEFINER.');

for (const needle of [
  'create table if not exists public.shopping_purchase_repeat_mutations',
  'primary key (user_id, mutation_id)',
  'alter table public.shopping_purchase_repeat_mutations enable row level security;',
  'revoke all on table public.shopping_purchase_repeat_mutations from authenticated;',
  'create or replace function public.repeat_shopping_purchase(',
  'p_purchase_id uuid,',
  'p_mutation_id uuid',
  'security definer',
  "set search_path = ''",
  'if p_mutation_id is null then',
  'm.mutation_id = p_mutation_id',
  'v_existing.purchase_id <> p_purchase_id',
  'on conflict (user_id, mutation_id) do nothing;',
  "'duplicate', true",
  "'duplicate', false",
  'set item_count = v_added',
  'public.shopping_custom_name_key(v_custom_name)',
  'custom_key = v_custom_key',
  'extensions.gen_random_uuid()',
  'revoke all on function public.repeat_shopping_purchase(uuid, uuid) from public;',
  'revoke all on function public.repeat_shopping_purchase(uuid, uuid) from anon;',
  'grant execute on function public.repeat_shopping_purchase(uuid, uuid) to authenticated;',
]) assert.ok(idempotentMigration.toLowerCase().includes(needle.toLowerCase()), `Chybí idempotent repeat SQL kontrakt: ${needle}`);

for (const needle of [
  'create or replace function public.repeat_shopping_purchase(p_purchase_id uuid, p_mutation_id uuid)',
  'security definer',
  "set search_path to ''",
  'from public.products p',
  'where p.id = v_product_id',
  'for key share;',
  'if found then',
  'v_product_id := null;',
  "nullif(btrim(v_item->>'name'), '')",
  'public.shopping_custom_name_key(v_custom_name)',
  'custom_key = v_custom_key',
]) assert.ok(fallbackMigration.toLowerCase().includes(needle.toLowerCase()), `Chybí fallback chybějícího produktu: ${needle}`);
const productLock = fallbackMigration.toLowerCase().indexOf('for key share;');
const productBranch = fallbackMigration.toLowerCase().indexOf('if found then', productLock);
const fallbackToCustom = fallbackMigration.toLowerCase().indexOf('v_product_id := null;', productBranch);
const customKey = fallbackMigration.toLowerCase().indexOf('v_custom_key := public.shopping_custom_name_key(v_custom_name);', fallbackToCustom);
assert.ok(productLock >= 0 && productBranch > productLock, 'Repeat RPC neověřuje existující produkt pod KEY SHARE lockem.');
assert.ok(fallbackToCustom > productBranch && customKey > fallbackToCustom, 'Chybějící produkt nepřechází do kanonické custom-item větve.');

const storage = new Map();
const rpcCalls = [];
const rpcResponses = [];
const clickListeners = [];
let uuidCounter = 1;
const nextUuid = () => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}`;
const db = {
  rpc(name, args) {
    rpcCalls.push([name, args]);
    return Promise.resolve(rpcResponses.shift() || { data:{ list_id:'list-1', item_count:2, duplicate:false }, error:null });
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
  crypto:{ randomUUID:nextUuid },
  location:{ reload() {} },
  Uint8Array,
  Date,
  Number,
  JSON,
  Promise,
  Map,
  String,
  Math,
  Object,
  Error
});
new Script(source, { filename:'shopping-repeat-purchase-sync-runtime.js' }).runInContext(context);
const api = context.window.SlevaoRepeatPurchaseSync;
assert.ok(api, 'Repeat purchase bridge se nenainstaloval.');
assert.equal(clickListeners.length, 1, 'Repeat purchase bridge nemá přesně jeden click listener.');
assert.deepEqual([clickListeners[0][0], clickListeners[0][2]], ['click', true], 'Repeat purchase listener musí běžet v capture fázi.');
assert.ok(source.includes('event.stopImmediatePropagation();'), 'Bridge nezastaví původní history bubble handler.');
assert.ok(!source.includes("db.from('shopping_list_items')"), 'Bridge nesmí zapisovat cloudové položky mimo atomickou RPC.');
assert.ok(source.includes("const REPEAT_PENDING_KEY = 'slevao-shopping-repeat-pending-v1';"), 'Bridge nemá persistentní pending klíč pro retry.');
assert.ok(source.includes('p_mutation_id: mutationId'), 'Cloud repeat neposílá mutation ID.');

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

const purchaseId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
rpcResponses.push({ data:null, error:{ message:'simulated lost response' } });
let firstError = null;
try {
  await api.repeatCloudPurchase(purchaseId, userId);
} catch (error) {
  firstError = error;
}
assert.equal(firstError?.message, 'simulated lost response', 'První retry simulace nevrátila očekávanou chybu.');
assert.equal(rpcCalls.length, 1, 'První cloud repeat zavolal RPC vícekrát.');
const firstArgs = rpcCalls[0][1];
assert.equal(firstArgs.p_purchase_id, purchaseId, 'Cloud repeat neposlal správné p_purchase_id.');
assert.match(firstArgs.p_mutation_id, /^[0-9a-f-]{36}$/i, 'Cloud repeat neposlal UUID mutation ID.');
const pendingAfterError = JSON.parse(storage.get('slevao-shopping-repeat-pending-v1') || '{}');
assert.equal(pendingAfterError[`${userId}:${purchaseId}`], firstArgs.p_mutation_id, 'Po nejasném výsledku se mutation ID neuchovalo pro retry.');

rpcResponses.push({ data:{ list_id:'list-1', item_count:2, duplicate:true }, error:null });
await api.repeatCloudPurchase(purchaseId, userId);
assert.equal(rpcCalls.length, 2, 'Retry cloud repeat zavolal neočekávaný počet RPC.');
assert.equal(rpcCalls[1][1].p_mutation_id, firstArgs.p_mutation_id, 'Retry nepoužil stejné mutation ID po ztracené odpovědi.');
assert.equal(storage.has('slevao-shopping-repeat-pending-v1'), false, 'Potvrzený repeat nesmazal pending mutation ID.');

rpcResponses.push({ data:{ list_id:'list-1', item_count:2, duplicate:false }, error:null });
await api.repeatCloudPurchase(purchaseId, userId);
assert.equal(rpcCalls.length, 3, 'Nový záměr zopakovat nákup nezavolal RPC.');
assert.notEqual(rpcCalls[2][1].p_mutation_id, firstArgs.p_mutation_id, 'Nový záměr po potvrzeném úspěchu znovu použil staré mutation ID.');
assert.equal(storage.has('slevao-shopping-repeat-pending-v1'), false, 'Nový potvrzený repeat nechal pending mutation ID.');

const assetUrl = html.match(/assets\/shopping-repeat-purchase-sync\.js\?v=[^"']+/)?.[0] || '';
assert.equal(assetUrl, 'assets/shopping-repeat-purchase-sync.js?v=20260828-2', 'seznam.html nemá retry-safe repeat bridge verzi 2.');
assert.ok(worker.includes(`'/${assetUrl}'`), 'PWA necachuje přesný repeat-purchase bridge ze seznam.html.');
const cacheMatch = worker.match(/CACHE_NAME = 'slevao-shell-(\d{8})-(\d+)'/);
assert.ok(cacheMatch, 'PWA shell nemá očekávaný verzovaný formát YYYYMMDD-revision.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 61),
  'PWA shell je starší než repeat retry fix 20260828-61.',
);

console.log('Shopping repeat purchase is atomic, retry-idempotent, survives missing catalog products and preserves guest merge semantics');
