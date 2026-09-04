import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
const cloudSource = readFileSync(new URL('assets/shopping-owner-cloud-refresh.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-cold-sync.js' });
new Script(cloudSource, { filename:'assets/shopping-owner-cloud-refresh.js' });
new Script(bootstrap, { filename:'assets/shopping-insights-bootstrap.js' });

const helperStart = source.indexOf('  const norm =');
const helperEnd = source.indexOf('\n  async function sync(userId)', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Cold-sync helpers nejdou izolovaně otestovat.');
const helpers = source.slice(helperStart, helperEnd);
const helperContext = { result:null, String, JSON, Array, Set, Map, Boolean };
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
  { local_id:'deleted', server_id:'row-deleted', product_id:'eggs', quantity:1 },
  {
    local_id:'deleted-recipe', server_id:'recipe-deleted', source:'recipe', recipe_id:'rizek',
    custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', quantity:1, unit:'ks', completed:false
  }
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
  rpc(name) {
    throw new Error(`Unexpected RPC ${name}`);
  },
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
  Map,
  Boolean,
  Promise
});
new Script(source, { filename:'shopping-owner-cold-sync-runtime.js' }).runInContext(context);
const api = window.SlevaoShoppingOwnerColdSync;
assert.ok(api, 'Cold-sync API se nenainstalovalo.');
const syncResult = await api.sync('user-1');
assert.equal(syncResult.changed, true, 'Stale serverový řádek nebyl při cold sync detekovaný.');
assert.equal(syncResult.removed, 2, 'Cold sync odstranil chybný počet stale řádků včetně vzdáleně smazaného receptu.');
assert.equal(syncResult.removed_before_recipe_sync, 2, 'Vzdáleně smazané řádky musí zmizet ještě před recipe RPC.');
assert.deepEqual(localRows.map((row) => row.local_id), ['unsynced', 'current'], 'Cold sync zahodil unsynced řádek nebo ponechal vzdáleně smazaný řádek/recept.');
assert.equal(writes.length, 1, 'Cold sync zapisuje localStorage vícekrát než je nutné.');

const recipeRow = {
  local_id:'recipe-eggs',
  source:'recipe',
  recipe_id:'rizek',
  recipe_ids:['palacinky'],
  custom_name:'Vejce (5 ks)',
  name:'Vejce (5 ks)',
  quantity:1,
  unit:'ks',
  completed:false,
  recipe_dirty:true,
};
assert.deepEqual(Array.from(api.recipeSources(recipeRow)).sort(), ['palacinky','rizek']);
assert.equal(api.adoptRecipeRemote(recipeRow, {
  id:'remote-eggs',
  custom_name:'Vejce (5 ks)',
  quantity:1,
  unit:'ks',
  is_completed:false,
  recipe_ids:['palacinky','rizek'],
  updated_at:'2026-09-04T13:00:00Z',
}), true);
assert.equal(recipeRow.server_id, 'remote-eggs');
assert.equal(recipeRow.source, 'recipe');
assert.equal(recipeRow.quantity, 1);
assert.equal(recipeRow.recipe_cloud_synced, 1);
assert.equal(recipeRow.recipe_dirty, undefined);
assert.deepEqual(Array.from(recipeRow.recipe_ids).sort(), ['palacinky','rizek']);

const manualConflict = {
  local_id:'recipe-onion',
  source:'recipe',
  recipe_id:'gulas',
  recipe_ids:['gulas'],
  custom_name:'Cibule (5 ks)',
  name:'Cibule (5 ks)',
  quantity:1,
  unit:'ks',
  completed:false,
  recipe_dirty:true,
};
assert.equal(api.adoptManualConflict(manualConflict, {
  id:'manual-onion',
  custom_name:'Cibule (5 ks)',
  quantity:2,
  unit:'ks',
  is_completed:false,
}, 'target_not_recipe_safe'), true);
assert.equal(manualConflict.server_id, 'manual-onion');
assert.equal(manualConflict.source, 'manual', 'Při nejasném konfliktu musí explicitní ruční položka vyhrát.');
assert.equal(manualConflict.quantity, 2, 'Ruční množství se nesmí přepsat receptovým quantity=1.');
assert.equal(manualConflict.recipe_id, undefined);
assert.equal(manualConflict.recipe_ids, undefined);
assert.equal(manualConflict.recipe_dirty, undefined);
assert.equal(manualConflict.recipe_sync_conflict, 'target_not_recipe_safe');

localRows = [{ local_id:'guest-new', product_id:'coffee', quantity:1 }];
writes.length = 0;
const guestResult = await api.sync('');
assert.equal(guestResult.changed, false, 'Guest cold sync nesmí měnit seznam.');
assert.equal(writes.length, 0, 'Guest cold sync zapsal localStorage.');

for (const needle of [
  "db.rpc('sync_own_shopping_list_recipe_item'",
  'p_source_item_id: row?.server_id || null',
  'p_recipe_ids: recipeSources(row)',
  "row.source = 'manual';",
  'delete row.recipe_ids;',
  'row.recipe_cloud_synced = 1;',
  "if (!serverId) return true;",
  'if (remoteIds.has(serverId)) return true;',
  'remoteKeys.has(key)',
  'let snapshot = await loadOwnerSnapshot(ownerId);',
  'let nextRows = reconcileBeforeMerge(localRows, snapshot.remoteRows);',
  'const recipeSync = await syncLocalRecipeRows(nextRows);',
  ".eq('user_id', ownerId)",
  ".eq('is_archived', false)",
  ".eq('shopping_list_id', list.id)",
  ".select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at,is_recipe,recipe_ids')",
  'localStorage.setItem(LIST_KEY, JSON.stringify(nextRows));',
]) assert.ok(source.includes(needle), `Chybí owner cold-sync kontrakt: ${needle}`);

const reconcilePos = source.indexOf('let nextRows = reconcileBeforeMerge(localRows, snapshot.remoteRows);');
const recipeSyncPos = source.indexOf('const recipeSync = await syncLocalRecipeRows(nextRows);', reconcilePos);
assert.ok(reconcilePos >= 0 && recipeSyncPos > reconcilePos, 'Recipe RPC nesmí běžet před odstraněním vzdáleně smazaných lokálních kopií.');

for (const needle of [
  'function normalizedRecipeIds(row)',
  "const isRecipe = remote ? Boolean(row?.is_recipe) : row?.source === 'recipe';",
  "isRecipe ? 'recipe' : 'manual'",
  'function applyRemoteProvenance(merged, remote)',
  "merged.source = 'recipe';",
  'merged.recipe_cloud_synced = 1;',
  "merged.source = 'manual';",
  'delete merged.recipe_ids;',
  ".select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,updated_at,is_recipe,recipe_ids')",
]) assert.ok(cloudSource.includes(needle), `Chybí recipe provenance v owner cloud refresh: ${needle}`);

const coldUrl = html.match(/assets\/shopping-owner-cold-sync\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
const publicNavUrl = html.match(/assets\/public-nav-upgrade\.js\?v=[^"']+/)?.[0] || '';
assert.equal(coldUrl, 'assets/shopping-owner-cold-sync.js?v=20260904-2', 'seznam.html nemá očekávanou cold-sync verzi.');
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
const coreRuntimeIndex = bootstrap.indexOf('    loadCoreRuntimes();', bootStart);
const markerIndex = bootstrap.indexOf('    setMarkerUserId(currentUserId);', coreRuntimeIndex);
const coldSyncIndex = bootstrap.indexOf('await window.SlevaoShoppingOwnerColdSync?.sync?.(currentUserId);', markerIndex);
const preflightIndex = bootstrap.indexOf('    finishOwnerPreflight();', coldSyncIndex);
const insightsIndex = bootstrap.indexOf('    loadInsights();', preflightIndex);
assert.ok(coreRuntimeIndex > bootStart, 'Bootstrap nespouští local-first jádro seznamu okamžitě.');
assert.ok(markerIndex > coreRuntimeIndex, 'Owner marker se nastavuje před local-first vykreslením seznamu.');
assert.ok(coldSyncIndex > markerIndex, 'Cold sync běží před nastavením správného owner scope.');
assert.ok(preflightIndex > coldSyncIndex, 'Owner preflight končí před dokončením cold sync.');
assert.ok(insightsIndex > preflightIndex, 'Shopping insights se spouští před dokončením owner preflight.');

console.log('Shopping owner cold sync preserves atomic recipe provenance and prevents deleted recipes from resurrecting');
