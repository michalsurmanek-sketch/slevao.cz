import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-cold-sync.js' });
new Script(bootstrap, { filename:'assets/shopping-insights-bootstrap.js' });

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

const coldUrl = html.match(/assets\/shopping-owner-cold-sync\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
const publicNavUrl = html.match(/assets\/public-nav-upgrade\.js\?v=[^"']+/)?.[0] || '';
assert.equal(coldUrl, 'assets/shopping-owner-cold-sync.js?v=20260828-1', 'seznam.html nemá očekávanou cold-sync verzi.');
const bootstrapMatch = bootstrapUrl.match(/\?v=(\d{8})-(\d+)$/);
assert.ok(bootstrapMatch, 'seznam.html nemá platnou YYYYMMDD-revision verzi shopping bootstrapu.');
const bootstrapDate = Number(bootstrapMatch[1]);
const bootstrapRevision = Number(bootstrapMatch[2]);
assert.ok(
  bootstrapDate > 20260828 || (bootstrapDate === 20260828 && bootstrapRevision >= 7),
  'seznam.html má bootstrap starší než guest-product fallback integrace v7.'
);
assert.match(publicNavUrl, /^assets\/public-nav-upgrade\.js\?v=\d{8}-\d+$/, 'seznam.html nemá verzovaný public-nav runtime.');
assert.ok(html.indexOf(publicNavUrl) < html.indexOf(coldUrl), 'Cold sync se načítá před owner-storage bridge.');
assert.ok(html.indexOf(coldUrl) < html.indexOf(bootstrapUrl), 'Cold sync se načítá až po shopping bootstrapu.');
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje cold-sync a bootstrap assety.');
assert.match(worker, /const freshRequest = new Request\(request, \{ cache: 'reload' \}\)/, 'Cold-sync runtime není v PWA network-first vrstvě.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesnou verzovanou cold-sync URL.');
const cacheMatch = worker.match(/const CACHE_VERSION = '(\d{8})-(\d+)';/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát YYYYMMDD-revision pro cold-sync ochranu.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 59),
  'PWA cache je starší než cold-sync fix 20260828-59.',
);

const bootStart = bootstrap.indexOf('  async function boot()');
const markerIndex = bootstrap.indexOf('    setMarkerUserId(currentUserId);', bootStart);
const coldSyncIndex = bootstrap.indexOf('await window.SlevaoShoppingOwnerColdSync?.sync?.(currentUserId);', markerIndex);
const runtimeIndex = bootstrap.indexOf('    loadShoppingRuntimes();', coldSyncIndex);
assert.ok(markerIndex > bootStart, 'Bootstrap nenastaví owner marker před cold sync.');
assert.ok(coldSyncIndex > markerIndex, 'Cold sync běží před nastavením správného owner scope.');
assert.ok(runtimeIndex > coldSyncIndex, 'Shopping runtimy se spouští před dokončením cold sync.');

console.log('Shopping owner cold sync prevents stale remote deletions from resurrecting');
