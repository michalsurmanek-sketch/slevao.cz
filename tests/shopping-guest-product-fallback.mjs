import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-guest-product-fallback.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-guest-product-fallback.js' });

const LIST_KEY = 'slevao-shopping-list-v1';
const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
const CLAIM_COMPLETED = '__slevao_guest_claim_completed';
const storage = new Map();
const productQueries = [];
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
const db = {
  from(table) {
    assert.equal(table, 'products', 'Fallback smí ověřovat pouze katalog products.');
    return {
      select(columns) {
        assert.equal(columns, 'id');
        return {
          in(column, ids) {
            assert.equal(column, 'id');
            productQueries.push([...ids]);
            return Promise.resolve({ data:[{ id:'live-product' }], error:null });
          }
        };
      }
    };
  }
};
const context = createContext({
  window:{
    SlevaoSupabase:{ getClient:() => db },
    SlevaoPublic:{ updateNavCount() {} }
  },
  localStorage,
  Number,
  String,
  JSON,
  Promise,
  Map,
  Set,
  Object,
  Array,
  Math,
  console
});
context.window.localStorage = localStorage;
new Script(source, { filename:'shopping-guest-product-fallback-runtime.js' }).runInContext(context);
const api = context.window.SlevaoShoppingGuestProductFallback;
assert.ok(api, 'Guest product fallback se nenainstaloval.');

storage.set(LIST_KEY, JSON.stringify([
  {
    local_id:'dead-local', product_id:'missing-product', selected_offer_id:'old-offer', server_id:null,
    name:'Mléko', custom_name:null, quantity:2, completed:false,
    [CLAIM_QUANTITY]:2, [CLAIM_COMPLETED]:false
  },
  {
    local_id:'custom-local', product_id:null, selected_offer_id:null, server_id:null,
    name:'mléko', custom_name:'mléko', quantity:1, completed:false,
    [CLAIM_QUANTITY]:1, [CLAIM_COMPLETED]:false
  },
  {
    local_id:'live-local', product_id:'live-product', selected_offer_id:'offer-live', server_id:null,
    name:'Chléb', custom_name:null, quantity:4, completed:true,
    [CLAIM_QUANTITY]:4, [CLAIM_COMPLETED]:true
  },
  {
    local_id:'server-stale', product_id:'server-missing-product', selected_offer_id:null, server_id:'server-row-1',
    name:'Sýr', custom_name:null, quantity:5, completed:false
  }
]));

const result = await api.sync();
assert.equal(result.changed, true, 'Fallback nenahlásil opravu chybějícího guest produktu.');
assert.equal(result.repaired, 1, 'Fallback opravil jiný počet lokálních product rows než očekáváno.');
assert.equal(productQueries.length, 1, 'Fallback provedl více katalogových dotazů místo jednoho batch ověření.');
assert.deepEqual(new Set(productQueries[0]), new Set(['missing-product', 'live-product']), 'Fallback ověřoval serverové řádky nebo vynechal lokální product ID.');

const rows = JSON.parse(storage.get(LIST_KEY));
assert.equal(rows.length, 3, 'Fallback nesloučil duplicitní custom klíč po převodu.');
const milk = rows.find((row) => String(row.custom_name || '').toLowerCase() === 'mléko');
const live = rows.find((row) => row.product_id === 'live-product');
const server = rows.find((row) => row.server_id === 'server-row-1');
assert.ok(milk, 'Chybějící produkt nebyl zachován jako custom položka.');
assert.equal(milk.product_id, null, 'Fallback ponechal neexistující product_id.');
assert.equal(milk.selected_offer_id, null, 'Fallback ponechal nabídku patřící chybějícímu produktu.');
assert.equal(milk.quantity, 3, 'Fallback nesloučil množství s existující custom položkou.');
assert.equal(milk[CLAIM_QUANTITY], 3, 'Fallback nezachoval součet guest claim množství.');
assert.equal(milk[CLAIM_COMPLETED], false, 'Fallback chybně označil sloučený aktivní guest claim jako dokončený.');
assert.equal(live?.quantity, 4, 'Existující katalogový produkt fallback změnil.');
assert.equal(live?.selected_offer_id, 'offer-live', 'Existující katalogový produkt přišel o platný selected_offer_id.');
assert.equal(server?.product_id, 'server-missing-product', 'Fallback nesmí měnit už synchronizované řádky se server_id.');

for (const needle of [
  'window.SlevaoShoppingGuestProductFallback?.sync?.()',
  'await window.SlevaoShoppingOwnerColdSync?.sync?.(currentUserId)',
]) assert.ok(bootstrap.includes(needle), `Bootstrap nemá guest fallback pořadí: ${needle}`);
const bootStart = bootstrap.indexOf('  async function boot()');
const coreRuntimeAt = bootstrap.indexOf('    loadCoreRuntimes();', bootStart);
const markerAt = bootstrap.indexOf('    setMarkerUserId(currentUserId);', coreRuntimeAt);
const coldSyncAt = bootstrap.indexOf('await window.SlevaoShoppingOwnerColdSync?.sync?.(currentUserId)', markerAt);
const fallbackAt = bootstrap.indexOf('window.SlevaoShoppingGuestProductFallback?.sync?.()', coldSyncAt);
const preflightAt = bootstrap.indexOf('    finishOwnerPreflight();', fallbackAt);
const insightsAt = bootstrap.indexOf('    loadInsights();', preflightAt);
assert.ok(coreRuntimeAt > bootStart, 'Guest fallback bootstrap musí zachovat okamžité local-first vykreslení seznamu.');
assert.ok(markerAt > coreRuntimeAt, 'Owner marker se musí nastavit až po local-first startu seznamu.');
assert.ok(coldSyncAt > markerAt, 'Owner cold-sync musí běžet po nastavení owner scope.');
assert.ok(fallbackAt > coldSyncAt, 'Guest product fallback musí běžet po owner cold-sync.');
assert.ok(preflightAt > fallbackAt, 'Owner preflight nesmí skončit před guest product fallbackem.');
assert.ok(insightsAt > preflightAt, 'Shopping insights se nesmí spustit před dokončením guest fallbacku a owner preflightu.');

const assetUrl = html.match(/assets\/shopping-guest-product-fallback\.js\?v=[^"']+/)?.[0] || '';
assert.equal(assetUrl, 'assets/shopping-guest-product-fallback.js?v=20260828-1', 'seznam.html nemá guest product fallback v1.');
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=([0-9]{8})-([0-9]+)/)?.[0] || '';
const bootstrapMatch = bootstrapUrl.match(/v=(\d{8})-(\d+)$/);
assert.ok(bootstrapMatch, 'Shopping insights bootstrap nemá očekávaný verzovaný formát YYYYMMDD-revision.');
const bootstrapDate = Number(bootstrapMatch[1]);
const bootstrapRevision = Number(bootstrapMatch[2]);
assert.ok(
  bootstrapDate > 20260828 || (bootstrapDate === 20260828 && bootstrapRevision >= 7),
  'Bootstrap po guest fallback integraci nesmí klesnout pod baseline 20260828-7.',
);
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje guest fallback a bootstrap assety.');
assert.match(worker, /const freshRequest = new Request\(request, \{ cache: 'reload' \}\)/, 'Guest fallback a bootstrap nejsou v PWA network-first runtime vrstvě.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesné verzované guest fallback\/bootstrap URL.');
const cacheMatch = worker.match(/const CACHE_VERSION = '(\d{8})-(\d+)';/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát YYYYMMDD-revision.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 64),
  'PWA cache se nesmí vrátit pod guest fallback baseline 20260828-64.',
);

console.log('Guest shopping rows safely fallback missing catalog products before cloud merge');
