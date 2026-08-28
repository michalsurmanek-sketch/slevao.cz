import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-budget-concurrency.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-budget-concurrency.js' });

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
const document = {
  addEventListener(type, callback, capture) { listeners.set(`${type}:${Boolean(capture)}`, callback); }
};
const window = {
  SlevaoSupabase:{ getClient:() => db },
  SlevaoPublic:{ toast() {} },
  setTimeout(callback) { callback(); return 1; }
};
const context = createContext({
  window,
  document,
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

for (let i = 0; i < 8 && !window.SlevaoShoppingBudgetConcurrency?.getState?.(); i++) {
  await new Promise((resolve) => setImmediate(resolve));
}
const api = window.SlevaoShoppingBudgetConcurrency;
assert.ok(api, 'Budget concurrency API se nenainstalovalo.');
assert.equal(db.__slevaoBudgetConcurrencyGuard, true, 'Budget concurrency guard neoznačil Supabase klienta.');
assert.equal(api.getState().budget, 1000, 'Počáteční cloudový rozpočet se nenačetl.');

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

for (const needle of [
  "table !== 'shopping_lists'",
  "Object.prototype.hasOwnProperty.call(values, 'budget')",
  ".eq('updated_at', currentState.updated_at)",
  "sameBudget(latestState.budget, currentState.budget)",
  'return persistBudget(next, false);',
  'event.stopImmediatePropagation();',
  'skipNextBudgetWrite = true;',
]) assert.ok(source.includes(needle), `Chybí budget concurrency kontrakt: ${needle}`);

assert.equal(typeof listeners.get('change:true'), 'function', 'Guard neposlouchá change v capture fázi.');
assert.equal(typeof listeners.get('blur:true'), 'function', 'Guard neposlouchá blur v capture fázi.');

const guardUrl = html.match(/assets\/shopping-budget-concurrency\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.match(guardUrl, /^assets\/shopping-budget-concurrency\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný budget concurrency guard.');
assert.ok(bootstrapUrl, 'seznam.html nemá shopping insights bootstrap.');
assert.ok(html.indexOf(guardUrl) < html.indexOf(bootstrapUrl), 'Budget concurrency guard musí běžet před shopping bootstrapem.');
assert.ok(worker.includes(`'/${guardUrl}'`), 'PWA necachuje přesný budget concurrency guard ze seznam.html.');
assert.match(worker, /CACHE_NAME = 'slevao-shell-20260828-57'/, 'PWA shell nebyl po přidání budget guardu posunut na verzi 57.');

console.log('Shopping budget concurrency guard OK');
