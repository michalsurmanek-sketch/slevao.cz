import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(bootstrap, { filename:'assets/shopping-insights-bootstrap.js' });

for (const needle of [
  "const ACTIVE_USER_KEY = 'slevao-active-user-v1';",
  "const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';",
  "const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';",
  "const LIST_URL = 'assets/shopping-list.js?v=20260822-2';",
  'function installBudgetOwnerBridge()',
  "activeUserId() ? `user:${activeUserId()}` : 'guest'",
  'Storage.prototype.getItem = function getItem',
  'Storage.prototype.setItem = function setItem',
  'Storage.prototype.removeItem = function removeItem',
  'const { data, error } = await db.auth.getSession();',
  'setMarkerUserId(currentUserId);',
  'bootedUserId = currentUserId;',
  'loadShoppingRuntimes();',
  'function loadList()',
  "db.auth.onAuthStateChange((event, nextSession) =>",
  "if (event === 'INITIAL_SESSION') return;",
  "if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;",
  'handleIdentityChange(nextUserId);',
  'if (sharedMode || reloadQueued) return;',
  "window.addEventListener('pagehide', () => authSubscription?.unsubscribe?.(), { once:true });",
]) {
  assert.ok(bootstrap.includes(needle), `Chybí shopping auth/owner guard: ${needle}`);
}

const setOwnerIndex = bootstrap.indexOf('    setMarkerUserId(currentUserId);');
const loadRuntimesIndex = bootstrap.indexOf('    loadShoppingRuntimes();', setOwnerIndex);
assert.ok(setOwnerIndex >= 0 && loadRuntimesIndex > setOwnerIndex, 'Owner marker musí být nastaven před vložením shopping runtime skriptů.');
assert.match(bootstrap, /function loadShoppingRuntimes\(\) \{\s*loadList\(\);\s*loadInsights\(\);\s*\}/, 'Shopping list musí být vložen před insights runtime.');

assert.match(html, /assets\/shopping-insights-bootstrap\.js\?v=20260822-2/, 'seznam.html nenačítá aktuální identity bootstrap.');
assert.doesNotMatch(html, /<script[^>]+src="assets\/shopping-list\.js/, 'seznam.html nesmí spouštět shopping-list.js před ověřením ownera.');
assert.doesNotMatch(html, /<script[^>]+src="assets\/shopping-insights\.js/, 'seznam.html nesmí spouštět shopping-insights.js napřímo.');
assert.match(worker, /assets\/shopping-insights-bootstrap\.js\?v=20260822-2/, 'PWA necachuje aktuální identity bootstrap.');
assert.match(worker, /assets\/shopping-list\.js\?v=20260822-2/, 'PWA necachuje dynamicky načítaný Shopping List runtime.');
assert.match(worker, /assets\/shopping-insights\.js\?v=20260821-1/, 'PWA necachuje dynamicky načítaný Insights runtime.');

const functionStart = bootstrap.indexOf('  function installBudgetOwnerBridge()');
const functionEnd = bootstrap.indexOf('\n  function markerUserId()', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Budget owner bridge nejde izolovaně otestovat.');
const bridgeFunction = bootstrap.slice(functionStart, functionEnd);

class StorageMock {
  constructor(values = {}) { this.map = new Map(Object.entries(values)); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

const ACTIVE = 'slevao-active-user-v1';
const LEGACY = 'slevao-shopping-budget-v1';
const oldLegacyValue = '9999';
const localStorage = new StorageMock({ [ACTIVE]:'user-a', [LEGACY]:oldLegacyValue });
const context = {
  Storage: StorageMock,
  window: { localStorage },
  localStorage,
  String,
  Object,
};
new Script(`
  const ACTIVE_USER_KEY = '${ACTIVE}';
  const LEGACY_BUDGET_KEY = '${LEGACY}';
  const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';
  ${bridgeFunction}
  installBudgetOwnerBridge();
`, { filename:'shopping-budget-owner-bridge-test.js' }).runInNewContext(context);

assert.equal(localStorage.getItem(LEGACY), null, 'Neidentifikovatelný legacy budget se připsal userovi A.');
assert.equal(localStorage.map.get(LEGACY), oldLegacyValue, 'Legacy budget byl destruktivně smazán místo karantény.');

localStorage.setItem(LEGACY, '1200');
assert.equal(localStorage.map.get('slevao-shopping-budget-v2:user:user-a'), '1200', 'Budget usera A není v jeho scope.');

localStorage.setItem(ACTIVE, 'user-b');
assert.equal(localStorage.getItem(LEGACY), null, 'User B vidí budget usera A.');
localStorage.setItem(LEGACY, '2400');
assert.equal(localStorage.map.get('slevao-shopping-budget-v2:user:user-b'), '2400', 'Budget usera B není v jeho scope.');
assert.equal(localStorage.map.get('slevao-shopping-budget-v2:user:user-a'), '1200', 'Zápis usera B změnil budget usera A.');

localStorage.setItem(ACTIVE, 'user-a');
assert.equal(localStorage.getItem(LEGACY), '1200', 'Návrat usera A neobnovil jeho vlastní budget.');
localStorage.removeItem(LEGACY);
assert.equal(localStorage.map.has('slevao-shopping-budget-v2:user:user-a'), false, 'Smazání budgetu usera A zasáhlo chybný scope.');
assert.equal(localStorage.map.get('slevao-shopping-budget-v2:user:user-b'), '2400', 'Smazání budgetu usera A zasáhlo usera B.');

localStorage.removeItem(ACTIVE);
localStorage.setItem(LEGACY, '500');
assert.equal(localStorage.map.get('slevao-shopping-budget-v2:guest'), '500', 'Guest budget není oddělený od účtů.');
assert.equal(localStorage.getItem(LEGACY), '500', 'Guest nečte svůj vlastní scoped budget.');

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createBootstrapScenario({ shared = false } = {}) {
  class ScenarioStorage {
    constructor(values = {}) { this.map = new Map(Object.entries(values)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    removeItem(key) { this.map.delete(String(key)); }
  }

  const storage = new ScenarioStorage({ [ACTIVE]:'user-a' });
  const appended = [];
  let authCallback = null;
  let reloads = 0;
  let unsubscribed = false;
  let pagehide = null;
  const auth = {
    async getSession() {
      return { data:{ session:{ user:{ id:'user-b' } } }, error:null };
    },
    onAuthStateChange(callback) {
      authCallback = callback;
      return { data:{ subscription:{ unsubscribe() { unsubscribed = true; } } } };
    },
  };
  const document = {
    querySelector() { return null; },
    createElement() { return {}; },
    head: {
      appendChild(script) {
        appended.push({ src:script.src, owner:storage.getItem(ACTIVE) });
      },
    },
  };
  const location = {
    search: shared ? '?share=shared-token' : '',
    hash: '',
    reload() { reloads += 1; },
  };
  const window = {
    localStorage: storage,
    supabase:{ createClient() { return { auth }; } },
    SlevaoPublic:{ updateNavCount() {} },
    setTimeout(callback) { callback(); return 1; },
    addEventListener(type, callback) { if (type === 'pagehide') pagehide = callback; },
  };
  const context = {
    Storage: ScenarioStorage,
    window,
    localStorage:storage,
    document,
    location,
    URLSearchParams,
    String,
    Object,
    JSON,
    Array,
    Boolean,
    console,
  };
  new Script(bootstrap, { filename:'shopping-auth-owner-bootstrap-test.js' }).runInNewContext(context);
  return {
    storage,
    appended,
    getAuthCallback: () => authCallback,
    getReloads: () => reloads,
    firePagehide: () => pagehide?.(),
    wasUnsubscribed: () => unsubscribed,
  };
}

const scenario = createBootstrapScenario();
await flushAsync();
assert.deepEqual(
  scenario.appended.map((entry) => entry.src),
  ['assets/shopping-list.js?v=20260822-2', 'assets/shopping-insights.js?v=20260821-1'],
  'Shopping runtimy se nenačetly v bezpečném pořadí.'
);
assert.ok(scenario.appended.every((entry) => entry.owner === 'user-b'), 'Shopping runtime se vložil dřív, než bootstrap přepnul stale owner marker na aktuální session user B.');
assert.equal(scenario.getReloads(), 0, 'Stale owner při prvním bootu nemá vyžadovat pozdní reload po startu shopping-list runtime.');

const authCallback = scenario.getAuthCallback();
assert.equal(typeof authCallback, 'function', 'Bootstrap nezaregistroval auth lifecycle listener.');
authCallback('TOKEN_REFRESHED', { user:{ id:'user-b' } });
assert.equal(scenario.getReloads(), 0, 'Token refresh stejného usera nesmí reloadovat seznam.');
authCallback('SIGNED_OUT', null);
assert.equal(scenario.storage.getItem(ACTIVE), null, 'SIGNED_OUT nevyčistil owner marker.');
assert.equal(scenario.getReloads(), 1, 'Změna identity user B -> guest musí čistě přehydratovat vlastní seznam.');
scenario.firePagehide();
assert.equal(scenario.wasUnsubscribed(), true, 'Auth listener se při opuštění stránky neodpojil.');

const sharedScenario = createBootstrapScenario({ shared:true });
await flushAsync();
const sharedAuthCallback = sharedScenario.getAuthCallback();
sharedAuthCallback('SIGNED_OUT', null);
assert.equal(sharedScenario.storage.getItem(ACTIVE), null, 'Shared režim neaktualizoval owner marker pro další navigaci.');
assert.equal(sharedScenario.getReloads(), 0, 'Shared-token seznam se nesmí reloadovat jen kvůli změně přihlášeného účtu.');

console.log('Shopping insights auth and budget scope OK');
