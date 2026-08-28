import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-item-concurrency.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828112500_owner_shopping_item_semantic_cas.sql', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-item-concurrency.js' });

for (const needle of [
  "const LIST_KEY = 'slevao-shopping-list-v1';",
  "const ACTIVE_USER_KEY = 'slevao-active-user-v1';",
  "nativeRpc('mutate_owner_shopping_list_item_if_current'",
  "nativeRpc('delete_owner_shopping_list_items_if_current'",
  "if (status === 'conflict' || status === 'missing')",
  "if (!markedUserId()) return executeNative(operation, payload, calls);",
  "document.addEventListener('change'",
  "document.addEventListener('click'",
  "event.target?.closest?.('#clearCompleted')",
]) assert.ok(source.includes(needle), `Chybí owner item concurrency kontrakt: ${needle}`);

for (const needle of [
  'security invoker',
  "v_current.quantity is distinct from p_expected_quantity",
  "v_current.is_completed is distinct from p_expected_is_completed",
  "revoke all on function public.mutate_owner_shopping_list_item_if_current",
  "grant execute on function public.mutate_owner_shopping_list_item_if_current",
  "revoke all on function public.delete_owner_shopping_list_items_if_current",
  "grant execute on function public.delete_owner_shopping_list_items_if_current",
]) assert.ok(migration.toLowerCase().includes(needle.toLowerCase()), `Chybí semantic CAS migration kontrakt: ${needle}`);

let rows = [
  {
    local_id:'local-1',
    server_id:'row-1',
    product_id:'product-1',
    selected_offer_id:null,
    quantity:1,
    unit:'ks',
    completed:false,
  },
];
const storage = new Map([
  ['slevao-active-user-v1', 'user-1'],
  ['slevao-shopping-list-v1', JSON.stringify(rows)],
]);
const localStorage = {
  getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
  setItem(key, value) {
    storage.set(String(key), String(value));
    if (String(key) === 'slevao-shopping-list-v1') rows = JSON.parse(String(value));
  },
  removeItem(key) { storage.delete(String(key)); },
};
function saveRows(next) {
  rows = next;
  storage.set('slevao-shopping-list-v1', JSON.stringify(rows));
}

const listeners = new Map();
const document = {
  querySelector(selector) { return selector === '.sfListLayout' ? {} : null; },
  addEventListener(type, callback) {
    const callbacks = listeners.get(type) || [];
    callbacks.push(callback);
    listeners.set(type, callbacks);
  },
  getElementById() { return null; },
};
let reloads = 0;
const location = {
  search:'',
  hash:'',
  reload() { reloads += 1; },
};
let nativeMutations = 0;
let nativeSelects = 0;
const nativeCalls = [];
function nativeBuilder(table) {
  const calls = [];
  let operation = 'select';
  let payload = null;
  const builder = {
    select(...args) { operation = 'select'; nativeSelects += 1; calls.push(['select', args]); return builder; },
    update(next) { operation = 'update'; payload = next; nativeMutations += 1; calls.push(['update', [next]]); return builder; },
    delete() { operation = 'delete'; nativeMutations += 1; calls.push(['delete', []]); return builder; },
    eq(...args) { calls.push(['eq', args]); return builder; },
    in(...args) { calls.push(['in', args]); return builder; },
    match(...args) { calls.push(['match', args]); return builder; },
    then(resolve, reject) {
      nativeCalls.push({ table, operation, payload, calls:[...calls] });
      return Promise.resolve({ data:[], error:null }).then(resolve, reject);
    },
  };
  return builder;
}

let singleStatus = 'updated';
let batchStatus = 'deleted';
const rpcCalls = [];
const db = {
  from(table) { return nativeBuilder(table); },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'mutate_owner_shopping_list_item_if_current') {
      return { data:{ status:singleStatus }, error:null };
    }
    if (name === 'delete_owner_shopping_list_items_if_current') {
      return { data:{ status:batchStatus, deleted_count:Array.isArray(args?.p_expected) ? args.p_expected.length : 0 }, error:null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  },
};
const window = {
  SlevaoSupabase:{ getClient:() => db },
  SlevaoPublic:{ toast() {} },
  setTimeout(callback) { callback(); return 1; },
};

const context = createContext({
  window,
  document,
  localStorage,
  location,
  URLSearchParams,
  Map,
  Set,
  Proxy,
  Reflect,
  Object,
  String,
  Number,
  Boolean,
  Math,
  Date,
  Array,
  JSON,
  Promise,
  Symbol,
  console,
});
new Script(source, { filename:'shopping-owner-item-concurrency-runtime.js' }).runInContext(context);
assert.equal(db.__slevaoOwnerItemSemanticCas, true, 'Bridge neoznačil Supabase klienta jako chráněný.');
assert.ok(window.SlevaoOwnerItemSemanticCas, 'Bridge nevystavil diagnostické API.');

function fireChange(kind = 'quantity') {
  const target = {
    matches(selector) {
      return selector.includes(kind === 'quantity' ? '[data-quantity]' : '[data-complete]');
    },
  };
  for (const callback of listeners.get('change') || []) callback({ target });
}
function fireClick(kind) {
  const target = {
    closest(selector) {
      if (kind === 'clear' && selector === '#clearCompleted') return {};
      if (kind === 'delete' && selector.includes('#listItems [data-delete]')) return {};
      if (kind === 'add' && selector === '#addCustom') return {};
      return null;
    },
  };
  for (const callback of listeners.get('click') || []) callback({ target });
}

fireChange('quantity');
saveRows([{ ...rows[0], quantity:2 }]);
let result = await db.from('shopping_list_items')
  .update({ quantity:2, unit:'ks', is_completed:false, selected_offer_id:null })
  .eq('id', 'row-1')
  .eq('shopping_list_id', 'list-1');
assert.equal(result.error, null, 'Aktuální owner update byl chybně odmítnut.');
assert.equal(nativeMutations, 0, 'Chráněný owner update propadl do slepého native UPDATE.');
assert.equal(rpcCalls.at(-1).name, 'mutate_owner_shopping_list_item_if_current');
assert.equal(rpcCalls.at(-1).args.p_expected_quantity, 1, 'CAS update nepoužil stav před UI mutací.');
assert.equal(rpcCalls.at(-1).args.p_next_quantity, 2, 'CAS update neposlal nový stav.');

singleStatus = 'conflict';
fireChange('quantity');
saveRows([{ ...rows[0], quantity:3 }]);
result = await db.from('shopping_list_items')
  .update({ quantity:3, unit:'ks', is_completed:false, selected_offer_id:null })
  .eq('id', 'row-1')
  .eq('shopping_list_id', 'list-1');
assert.equal(result.error?.code, 'SLEVAO_ITEM_CONFLICT', 'Stale owner update nebyl vrácen jako konflikt.');
assert.equal(reloads, 1, 'Konflikt nevyvolal načtení aktuálního cloudového stavu.');

singleStatus = 'deleted';
saveRows([{ ...rows[0], quantity:2 }]);
fireClick('delete');
result = await db.from('shopping_list_items')
  .delete()
  .eq('id', 'row-1')
  .eq('shopping_list_id', 'list-1');
assert.equal(result.error, null, 'Aktuální single delete byl chybně odmítnut.');
assert.equal(rpcCalls.at(-1).args.p_action, 'delete', 'Single delete nepoužil semantic CAS RPC.');

saveRows([
  { local_id:'a', server_id:'row-a', quantity:1, unit:'ks', completed:true, selected_offer_id:null },
  { local_id:'b', server_id:'row-b', quantity:4, unit:'ks', completed:true, selected_offer_id:'offer-b' },
]);
batchStatus = 'deleted';
fireClick('clear');
result = await db.from('shopping_list_items')
  .delete()
  .eq('shopping_list_id', 'list-1')
  .in('id', ['row-a', 'row-b']);
assert.equal(result.error, null, 'Aktuální batch delete byl chybně odmítnut.');
assert.equal(rpcCalls.at(-1).name, 'delete_owner_shopping_list_items_if_current');
assert.equal(rpcCalls.at(-1).args.p_expected.length, 2, 'Batch CAS neposlal snapshot všech mazaných položek.');
assert.equal(rpcCalls.at(-1).args.p_expected[1].quantity, 4, 'Batch CAS ztratil očekávané množství.');
assert.equal(rpcCalls.at(-1).args.p_expected[1].selected_offer_id, 'offer-b', 'Batch CAS ztratil očekávanou nabídku.');

await db.from('shopping_list_items').select('id').eq('id', 'row-a');
assert.ok(nativeSelects > 0, 'Bridge zasahuje i do běžného SELECTu shopping_list_items.');

storage.delete('slevao-active-user-v1');
const nativeBeforeGuest = nativeMutations;
await db.from('shopping_list_items')
  .update({ quantity:9 })
  .eq('id', 'row-a')
  .eq('shopping_list_id', 'list-1');
assert.equal(nativeMutations, nativeBeforeGuest + 1, 'Guest/non-owner UPDATE nebyl ponechán původnímu runtime.');

console.log('Shopping owner item semantic concurrency guard OK');
