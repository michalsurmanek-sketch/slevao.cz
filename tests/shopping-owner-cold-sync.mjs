import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-cold-sync.js' });

const helperStart = source.indexOf('  const norm =');
const helperEnd = source.indexOf('\n  async function sync(userId)', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Cold-sync helpers nejdou izolovaně otestovat.');
const helpers = source.slice(helperStart, helperEnd);
const helperContext = { result:null, String, JSON, Array, Set, Boolean };
new Script(`
  const LIST_KEY = 'slevao-shopping-list-v1';
  const localStorage = { getItem(){ return '[]'; } };
  ${helpers}
  const local = [
    { local_id:'local-new', product_id:'bread', quantity:1 },
    { local_id:'keep-id', server_id:'row-1', product_id:'milk', quantity:2 },
    { local_id:'stale', server_id:'row-deleted', product_id:'eggs', quantity:1 },
    { local_id:'readded', server_id:'old-cheese-id', product_id:'cheese', quantity:1 },
    { local_id:'custom-stale', server_id:'old-custom-id', custom_name:'Rohlíky', quantity:5 },
    { local_id:'custom-readded', server_id:'old-apples-id', custom_name:'Jablka', quantity:2 }
  ];
  const remote = [
    { id:'row-1', product_id:'milk' },
    { id:'new-cheese-id', product_id:'cheese' },
    { id:'new-apples-id', custom_name:'jablka' }
  ];
  const next = reconcileBeforeMerge(local, remote);
  globalThis.result = {
    ids: next.map((row) => row.local_id),
    milkKey: itemKey({ product_id:'milk' }),
    customKey: itemKey({ custom_name:'Rohlíky' })
  };
`, { filename:'shopping-owner-cold-sync-helpers.js' }).runInNewContext(helperContext);

assert.deepEqual(
  Array.from(helperContext.result.ids),
  ['local-new', 'keep-id', 'readded', 'custom-readded'],
  'Cold sync neodlišil unsynced, aktuální, vzdáleně smazané a znovu přidané řádky.'
);
assert.equal(helperContext.result.milkKey, 'p:milk');
assert.equal(helperContext.result.customKey, 'c:rohliky');

let localRows = [
  { local_id:'unsynced', product_id:'bread', quantity:1 },
  { local_id:'current', server_id:'row-1', product_id:'milk', quantity:2 },
  { local_id:'deleted', server_id:'row-deleted', product_id:'eggs', quantity:1 }
];
const writes = [];
const localStorage = {
  getItem(key) {
    assert.equal(key, 'slevao-shopping-list-v1');
    return JSON.stringify(localRows);
  },
  setItem(key, value) {
    assert.equal(key, 'slevao-shopping-list-v1');
    localRows = JSON.parse(value);
    writes.push(localRows);
  }
};

function query(result) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
  };
  return builder;
}

const db = {
  from(table) {
    if (table === 'shopping_lists') return query({ data:{ id:'list-1' }, error:null });
    if (table === 'shopping_list_items') {
      return query({ data:[{ id:'row-1', product_id:'milk', custom_name:null }], error:null });
    }
    throw new Error(`Unexpected table ${table}`);
  }
};
const document = { querySelector(selector) { return selector === '.sfListLayout' ? {} : null; } };
const window = { SlevaoSupabase:{ getClient:() => db }, SlevaoPublic:{ updateNavCount() {} } };
const context = createContext({
  window,
  document,
  localStorage,
  location:{ search:'', hash:'' },
  URLSearchParams,
  String,
  JSON,
  Array,
  Set,
  Boolean,
  Promise
});
new Script(source, { filename:'shopping-owner-cold-sync-runtime.js' }).runInContext(context);
const api = window.SlevaoShoppingOwnerColdSync;
assert.ok(api, 'Cold-sync API se nenainstalovalo.');
const syncResult = await api.sync('user-1');
assert.equal(syncResult.changed, true, 'Stale serverový řádek nebyl při cold sync detekovaný.');
assert.equal(syncResult.removed, 1, 'Cold sync odstranil chybný počet stale řádků.');
assert.deepEqual(localRows.map((row) => row.local_id), ['unsynced', 'current'], 'Cold sync zahodil unsynced řádek nebo ponechal vzdáleně smazaný řádek.');
assert.equal(writes.length, 1, 'Cold sync zapisuje localStorage vícekrát než je nutné.');

localRows = [{ local_id:'guest-new', product_id:'coffee', quantity:1 }];
writes.length = 0;
const guestResult = await api.sync('');
assert.equal(guestResult.changed, false, 'Guest cold sync nesmí měnit seznam.');
assert.equal(writes.length, 0, 'Guest cold sync zapsal localStorage.');

for (const needle of [
  "if (!serverId) return true;",
  'if (remoteIds.has(serverId)) return true;',
  'remoteKeys.has(key)',
  ".eq('user_id', ownerId)",
  ".eq('is_archived', false)",
  ".eq('shopping_list_id', list.id)",
  'localStorage.setItem(LIST_KEY, JSON.stringify(nextRows));',
]) assert.ok(source.includes(needle), `Chybí owner cold-sync kontrakt: ${needle}`);

console.log('Shopping owner cold sync prevents stale remote deletions from resurrecting');
