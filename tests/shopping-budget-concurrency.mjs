import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-budget-concurrency.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-budget-concurrency.js' });
new Script(bootstrap, { filename:'assets/shopping-insights-bootstrap.js' });

let remote = {
  id:'list-1',
  budget:1000,
  updated_at:'2026-08-28T10:00:00.000Z',
  created_at:'2026-08-01T10:00:00.000Z'
};
const updateAttempts = [];
let forcedUnrelatedChange = null;

function makeResultBuilder(executor) {
  const filters = [];
  let operation = 'select';
  let values = null;
  const builder = {
    select() { return builder; },
    update(next) { operation = 'update'; values = next; return builder; },
    eq(field, value) { filters.push([field, value]); return builder; },
    order() { return builder; },
    limit() { return builder; },
    async maybeSingle() { return executor({ operation, values, filters:[...filters] }); },
    then(resolve, reject) { return builder.maybeSingle().then(resolve, reject); }
  };
  return builder;
}

const db = {
  auth: {
    async getSession() {
      return { data:{ session:{ user:{ id:'user-1' } } }, error:null };
    }
  },
  from(table) {
    assert.equal(table, 'shopping_lists');
    return makeResultBuilder(({ operation, values, filters }) => {
      if (operation === 'select') return Promise.resolve({ data:{ ...remote }, error:null });

      const expected = filters.find(([field]) => field === 'updated_at')?.[1] || null;
      updateAttempts.push({ expected, budget:values?.budget ?? null });

      if (forcedUnrelatedChange) {
        remote = { ...remote, ...forcedUnrelatedChange };
        forcedUnrelatedChange = null;
      }

      if (expected && expected !== remote.updated_at) return Promise.resolve({ data:null, error:null });
      remote = {
        ...remote,
        budget:values?.budget ?? null,
        updated_at:new Date(new Date(remote.updated_at).getTime() + 1000).toISOString()
      };
      return Promise.resolve({ data:{ id:remote.id, budget:remote.budget, updated_at:remote.updated_at }, error:null });
    });
  }
};

const listeners = new Map();
const storageMap = new Map([['slevao-shopping-budget-v1', 'stale-local-budget']]);
const localStorage = {
  getItem(key) { return storageMap.has(String(key)) ? storageMap.get(String(key)) : null; },
  setItem(key, value) { storageMap.set(String(key), String(value)); },
  removeItem(key) { storageMap.delete(String(key)); }
};
const document = {
  addEventListener(type, callback, capture) { listeners.set(`${type}:${Boolean(capture)}`, callback); }
};
const window = {
  SlevaoSupabase:{ getClient:() => db },
  SlevaoPublic:{ toast() {} },
  localStorage,
  setTimeout(callback) { callback(); return 1; }
};
const context = createContext({
  window,
  document,
  localStorage,
  location:{ search:'', hash:'' },
  URLSearchParams,
  Number,
  Math,
  Object,
  Promise,
  String,
  Event: class EventMock {
    constructor(type, options = {}) { this.type = type; this.bubbles = Boolean(options.bubbles); }
  },
  setTimeout:window.setTimeout,
  console
});
new Script(source, { filename:'shopping-budget-concurrency-runtime.js' }).runInContext(context);

assert.equal(typeof window.SlevaoShoppingBudgetConcurrencyReady?.then, 'function', 'Budget guard nevystavil awaitable readiness kontrakt před bootstrapem.');
await window.SlevaoShoppingBudgetConcurrencyReady;
const api = window.SlevaoShoppingBudgetConcurrency;
assert.ok(api, 'Budget concurrency API se nenainstalovalo.');
assert.equal(db.__slevaoBudgetConcurrencyGuard, true, 'Budget concurrency guard neoznačil Supabase klienta.');
assert.equal(api.getState().budget, 1000, 'Počáteční cloudový rozpočet se nenačetl.');
assert.equal(api.syncStorage(), true, 'Cloudový rozpočet se nepodařilo synchronizovat do owner storage.');
assert.equal(localStorage.getItem('slevao-shopping-budget-v1'), '1000', 'Cloudový rozpočet nepřepsal stale lokální fallback před bootem insights.');

const first = await api.persistBudget(1500);
assert.equal(first.conflict, false, 'Běžné uložení rozpočtu bylo chybně vyhodnoceno jako konflikt.');
assert.equal(remote.budget, 1500);
assert.equal(updateAttempts.at(-1).expected, '2026-08-28T10:00:00.000Z', 'První UPDATE nepoužil načtenou updated_at verzi.');
const versionAfterFirst = remote.updated_at;

remote = { ...remote, budget:2000, updated_at:'2026-08-28T10:05:00.000Z' };
const conflict = await api.persistBudget(2500);
assert.equal(conflict.conflict, true, 'Novější rozpočet z druhého zařízení nebyl rozpoznán jako konflikt.');
assert.equal(remote.budget, 2000, 'Stará karta přepsala novější cloudový rozpočet.');
assert.equal(api.getState().budget, 2000, 'Po konfliktu se guard nepřepnul na aktuální cloudový rozpočet.');
assert.equal(updateAttempts.at(-1).expected, versionAfterFirst, 'Konfliktní UPDATE nepoužil stale verzi staré karty.');

const beforeUnrelatedAttempts = updateAttempts.length;
forcedUnrelatedChange = { updated_at:'2026-08-28T10:06:00.000Z' };
const unrelated = await api.persistBudget(2200);
assert.equal(unrelated.conflict, false, 'Pouhá změna jiné části seznamu zablokovala rozpočet jako konflikt.');
assert.equal(remote.budget, 2200, 'Guard po unrelated updated_at konfliktu nezopakoval CAS.');
assert.equal(updateAttempts.length, beforeUnrelatedAttempts + 2, 'Unrelated updated_at konflikt se nemá opakovat více než jednou.');
assert.equal(updateAttempts.at(-1).expected, '2026-08-28T10:06:00.000Z', 'Retry nepoužil nejnovější updated_at verzi.');

const versionBeforeSameValue = remote.updated_at;
remote = { ...remote, budget:2300, updated_at:'2026-08-28T10:08:00.000Z' };
const sameValue = await api.persistBudget(2300);
assert.equal(sameValue.conflict, false, 'Stejná hodnota už uložená na druhém zařízení nemá být konflikt.');
assert.equal(remote.budget, 2300);
assert.equal(updateAttempts.at(-1).expected, versionBeforeSameValue, 'Same-value kontrola nepoužila poslední známou verzi.');

remote = { ...remote, budget:null, updated_at:'2026-08-28T10:09:00.000Z' };
const clearedElsewhere = await api.persistBudget(9999);
assert.equal(clearedElsewhere.conflict, true, 'Zrušení rozpočtu na druhém zařízení nebylo rozpoznáno jako novější cloudový stav.');
assert.equal(api.getState().budget, 0, 'Cloudové NULL se nepřevedlo na nulový rozpočet.');
localStorage.setItem('slevao-shopping-budget-v1', '2300');
assert.equal(api.syncStorage(), true);
assert.equal(localStorage.getItem('slevao-shopping-budget-v1'), null, 'Cloudové NULL neodstranilo stale lokální rozpočet před cold-load bootem.');

for (const needle of [
  "const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';",
  "table !== 'shopping_lists'",
  "Object.prototype.hasOwnProperty.call(values, 'budget')",
  ".eq('updated_at', currentState.updated_at)",
  "sameBudget(latestState.budget, currentState.budget)",
  'return persistBudget(next, false);',
  'function syncStorage()',
  'localStorage.removeItem(LEGACY_BUDGET_KEY);',
  'const initialization = (async () =>',
  'window.SlevaoShoppingBudgetConcurrencyReady = initialization;',
  'await ensureState({ attempts: 1 });',
  'event.stopImmediatePropagation();',
  'skipNextBudgetWrite = true;',
]) assert.ok(source.includes(needle), `Chybí budget concurrency/cold-load kontrakt: ${needle}`);

assert.equal(typeof listeners.get('change:true'), 'function', 'Guard neposlouchá change v capture fázi.');
assert.equal(typeof listeners.get('blur:true'), 'function', 'Guard neposlouchá blur v capture fázi.');

const bootStart = bootstrap.indexOf('  async function boot()');
const coreRuntimeIndex = bootstrap.indexOf('    loadCoreRuntimes();', bootStart);
const markerIndex = bootstrap.indexOf('    setMarkerUserId(currentUserId);', coreRuntimeIndex);
const readyIndex = bootstrap.indexOf('window.SlevaoShoppingBudgetConcurrencyReady', markerIndex);
const syncIndex = bootstrap.indexOf('window.SlevaoShoppingBudgetConcurrency?.syncStorage?.();', readyIndex);
const finishPreflightIndex = bootstrap.indexOf('    finishOwnerPreflight();', syncIndex);
const insightsRuntimeIndex = bootstrap.indexOf('    loadInsights();', finishPreflightIndex);
assert.ok(bootStart >= 0 && coreRuntimeIndex > bootStart, 'Bootstrap nenačte lokální shopping-list runtime uvnitř bootu.');
assert.ok(markerIndex > coreRuntimeIndex, 'Core shopping-list runtime musí být dostupný ještě před cloudovou identitou.');
assert.ok(readyIndex > markerIndex, 'Bootstrap čeká na cloud budget dřív, než nastaví správného ownera.');
assert.ok(syncIndex > readyIndex, 'Bootstrap nesynchronizuje cloud budget po readiness.');
assert.ok(finishPreflightIndex > syncIndex, 'Owner preflight končí dřív než cloud-authoritative budget synchronizace.');
assert.ok(insightsRuntimeIndex > finishPreflightIndex, 'Budget/insights runtime se načítá před cloud-authoritative budget synchronizací.');

const guardUrl = html.match(/assets\/shopping-budget-concurrency\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.equal(guardUrl, 'assets/shopping-budget-concurrency.js?v=20260828-2', 'seznam.html nemá očekávanou cold-load verzi budget guardu.');
const bootstrapVersionMatch = bootstrapUrl.match(/\?v=(\d{8})-(\d+)$/);
assert.ok(bootstrapVersionMatch, 'seznam.html nemá verzovaný shopping bootstrap ve formátu YYYYMMDD-revision.');
const bootstrapDate = Number(bootstrapVersionMatch[1]);
const bootstrapRevision = Number(bootstrapVersionMatch[2]);
assert.ok(
  bootstrapDate > 20260828 || (bootstrapDate === 20260828 && bootstrapRevision >= 7),
  'seznam.html má bootstrap starší než guest-product fallback integrace v7.'
);
assert.ok(html.indexOf(guardUrl) < html.indexOf(bootstrapUrl), 'Budget concurrency guard musí běžet před shopping bootstrapem.');
assert.ok(!worker.includes(`'/${guardUrl}'`), 'Budget concurrency guard se nesmí vrátit do install-time PWA precache.');
assert.ok(!worker.includes(`'/${bootstrapUrl}'`), 'Shopping bootstrap se nesmí vrátit do install-time PWA precache.');
const cacheMatch = worker.match(/CACHE_VERSION = '(\d{8})-(\d+)'/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát YYYYMMDD-revision pro cold-sync ochranu.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 59),
  'PWA cache je starší než cold-sync integrace 20260828-59.',
);
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'Budget/bootstrap JS musí být obsloužený jako kritický runtime asset.');
assert.ok(worker.includes("cache: 'reload'"), 'Budget/bootstrap JS musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Budget/bootstrap JS musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('Shopping budget concurrency, local-first list and cloud-authoritative insights guard OK');
