import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-history-freshness.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-history-freshness.js' });

assert.ok(source.includes("const HISTORY_KEY = 'slevao-shopping-history-v1';"), 'History freshness nepoužívá kanonický local history key.');
assert.ok(source.includes("document.addEventListener('visibilitychange'"), 'History freshness nereaguje na návrat do viditelné karty.');
assert.ok(source.includes("window.addEventListener('focus'"), 'History freshness nereaguje na focus okna.');
assert.ok(source.includes("window.addEventListener('storage'"), 'History freshness nereaguje na změnu guest historie v jiné kartě.');
assert.ok(!source.includes('setInterval('), 'History freshness nesmí zavádět pravidelný polling.');
assert.ok(source.includes(".eq('user_id', userId)"), 'Cloud history query není scoped na přihlášeného uživatele.');
assert.ok(source.includes(".order('completed_at', { ascending:false })"), 'Cloud history query nedrží stejné pořadí jako hlavní historie.');
assert.ok(source.includes('.limit(30)'), 'Cloud history freshness musí držet stejný limit 30 nákupů.');

function boot({ visibleIds = [], cloudIds = [], sessionUserId = 'user-1', localHistory = [] } = {}) {
  const listeners = { document:[], window:[] };
  let reloads = 0;
  const storage = new Map([['slevao-shopping-history-v1', JSON.stringify(localHistory)]]);
  const cloudState = { ids:[...cloudIds] };

  const historyContainer = {
    querySelector(selector) {
      return selector === '.sfInsightsLoading' ? null : null;
    },
    querySelectorAll(selector) {
      if (selector !== '[data-purchase-id]') return [];
      return visibleIds.map((id) => ({ dataset:{ purchaseId:id } }));
    }
  };

  function historyQuery() {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      then(resolve, reject) {
        return Promise.resolve({ data:cloudState.ids.map((id) => ({ id })), error:null }).then(resolve, reject);
      }
    };
    return builder;
  }

  const db = {
    from(table) {
      assert.equal(table, 'shopping_list_purchases');
      return historyQuery();
    },
    auth:{
      getSession() {
        return Promise.resolve({
          data:{ session:sessionUserId ? { user:{ id:sessionUserId } } : null },
          error:null
        });
      }
    }
  };

  const document = {
    hidden:false,
    querySelector(selector) { return selector === '.sfListLayout' ? {} : null; },
    getElementById(id) { return id === 'shoppingHistory' ? historyContainer : null; },
    addEventListener(type, handler) { listeners.document.push([type, handler]); }
  };
  const window = {
    SlevaoSupabase:{ getClient:() => db },
    addEventListener(type, handler) { listeners.window.push([type, handler]); },
    setTimeout() {}
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  };
  const location = {
    search:'',
    hash:'',
    reload() { reloads += 1; }
  };

  const context = createContext({
    window,
    document,
    localStorage,
    location,
    URLSearchParams,
    Date,
    JSON,
    Array,
    String,
    Boolean,
    Promise,
    Object,
    console:{ debug() {} }
  });
  new Script(source, { filename:'shopping-history-freshness-runtime.js' }).runInContext(context);
  return {
    api:window.SlevaoShoppingHistoryFreshness,
    listeners,
    cloudState,
    getReloads:() => reloads
  };
}

const same = boot({ visibleIds:['p-2','p-1'], cloudIds:['p-2','p-1'] });
assert.ok(same.api, 'History freshness API se nenainstalovalo.');
assert.deepEqual(same.listeners.document.map(([type]) => type), ['visibilitychange'], 'History freshness má neočekávané document listenery.');
assert.deepEqual(same.listeners.window.map(([type]) => type).sort(), ['focus','storage'], 'History freshness má neočekávané window listenery.');
assert.equal(same.api.sameIds(['a','b'], ['a','b']), true, 'Stejné history ID nejsou rozpoznány jako shodné.');
assert.equal(same.api.sameIds(['a'], ['b']), false, 'Rozdílné history ID jsou chybně rozpoznány jako shodné.');
assert.equal(await same.api.check({ force:true }), false, 'Stejná cloud historie vyvolala reload.');
assert.equal(same.getReloads(), 0, 'Stejná cloud historie reloadovala stránku.');

const changed = boot({ visibleIds:['p-2','p-1'], cloudIds:['p-3','p-2','p-1'] });
assert.equal(await changed.api.check({ force:true }), true, 'Nový cloud nákup nebyl detekován.');
assert.equal(changed.getReloads(), 1, 'Nový cloud nákup nevyvolal přesně jeden reload.');
assert.equal(await changed.api.check({ force:true }), false, 'Po naplánovaném reloadu guard znovu kontroluje historii.');
assert.equal(changed.getReloads(), 1, 'Po naplánovaném reloadu guard vyvolal další reload.');

const guest = boot({
  visibleIds:['local-2'],
  cloudIds:[],
  sessionUserId:'',
  localHistory:[{ id:'local-3' }, { id:'local-2' }]
});
assert.deepEqual(Array.from(guest.api.localPurchaseIds()), ['local-3','local-2'], 'Guest history freshness nečte lokální historii ve správném pořadí.');
assert.equal(await guest.api.check({ force:true }), true, 'Změna guest historie v jiné kartě nebyla detekována.');
assert.equal(guest.getReloads(), 1, 'Změna guest historie nevyvolala reload.');

const assetUrl = html.match(/assets\/shopping-history-freshness\.js\?v=[^"']+/)?.[0] || '';
assert.equal(assetUrl, 'assets/shopping-history-freshness.js?v=20260828-1', 'seznam.html nenačítá history freshness guard v1.');
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje history freshness asset.');
assert.match(worker, /const freshRequest = new Request\(request, \{ cache: 'reload' \}\)/, 'History freshness asset není v PWA network-first runtime vrstvě.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesnou verzovanou history freshness URL.');
const cacheMatch = worker.match(/const CACHE_VERSION = '(\d{8})-(\d+)';/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát YYYYMMDD-revision.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 62),
  'PWA cache se nesmí vrátit pod history freshness baseline 20260828-62.',
);

console.log('Shopping history freshness detects cross-device history changes without polling');
