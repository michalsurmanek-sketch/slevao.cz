import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(bootstrap, { filename:'assets/shopping-insights-bootstrap.js' });

const ownerCustomAddUrl = bootstrap.match(/const OWNER_CUSTOM_ADD_URL = '([^']+)'/)?.[1] || '';
const sharedAddGuardUrl = bootstrap.match(/const SHARED_ADD_GUARD_URL = '([^']+)'/)?.[1] || '';
const listUrl = bootstrap.match(/const LIST_URL = '([^']+)'/)?.[1] || '';
const insightsUrl = bootstrap.match(/const INSIGHTS_URL = '([^']+)'/)?.[1] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[0-9-]+/)?.[0] || '';
assert.match(ownerCustomAddUrl, /^assets\/shopping-owner-custom-add-bridge\.js\?v=[0-9-]+$/, 'Bootstrap musí používat verzovaný owner custom add bridge.');
assert.match(sharedAddGuardUrl, /^assets\/shopping-shared-add-submit-guard\.js\?v=[0-9-]+$/, 'Bootstrap musí používat verzovaný shared add submit guard.');
assert.match(listUrl, /^assets\/shopping-list\.js\?v=[0-9-]+$/, 'Bootstrap musí používat verzovaný shopping-list runtime.');
assert.match(insightsUrl, /^assets\/shopping-insights\.js\?v=[0-9-]+$/, 'Bootstrap musí používat verzovaný insights runtime.');
assert.ok(bootstrapUrl, 'seznam.html musí načítat verzovaný identity bootstrap.');

for (const needle of [
  "const ACTIVE_USER_KEY = 'slevao-active-user-v1';",
  "const LEGACY_BUDGET_KEY = 'slevao-shopping-budget-v1';",
  "const BUDGET_KEY_PREFIX = 'slevao-shopping-budget-v2:';",
  'function installBudgetOwnerBridge()',
  "activeUserId() ? `user:${activeUserId()}` : 'guest'",
  'Storage.prototype.getItem = function getItem',
  'Storage.prototype.setItem = function setItem',
  'Storage.prototype.removeItem = function removeItem',
  'const { data, error } = await db.auth.getSession();',
  'setMarkerUserId(currentUserId);',
  'bootedUserId = currentUserId;',
  'function loadCoreRuntimes()',
  'loadCoreRuntimes();',
  'const ownerPreflight = new Promise((resolve) => {',
  'window.SlevaoShoppingOwnerPreflight = ownerPreflight;',
  'finishOwnerPreflight();',
  'function loadOwnerCustomAddBridge()',
  'function loadSharedAddGuard()',
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

const bootStart = bootstrap.indexOf('  async function boot()');
const coreLoadIndex = bootstrap.indexOf('    loadCoreRuntimes();', bootStart);
const sessionReadIndex = bootstrap.indexOf('      const { data, error } = await db.auth.getSession();', bootStart);
assert.ok(
  bootStart >= 0 && coreLoadIndex > bootStart && sessionReadIndex > coreLoadIndex,
  'Lokální shopping-list runtime se musí vložit před čekáním na cloudovou session.'
);
const setOwnerIndex = bootstrap.indexOf('    setMarkerUserId(currentUserId);', sessionReadIndex);
const finishPreflightIndex = bootstrap.indexOf('    finishOwnerPreflight();', setOwnerIndex);
const insightsAfterPreflightIndex = bootstrap.indexOf('    loadInsights();', finishPreflightIndex);
assert.ok(
  setOwnerIndex > sessionReadIndex && finishPreflightIndex > setOwnerIndex && insightsAfterPreflightIndex > finishPreflightIndex,
  'Owner marker a cloud preflight musí být dokončené před vložením insights runtime.'
);

const coreRuntimeBlockStart = bootstrap.indexOf('  function loadCoreRuntimes()');
const ownerAddRuntimeIndex = bootstrap.indexOf('    loadOwnerCustomAddBridge();', coreRuntimeBlockStart);
const sharedAddRuntimeIndex = bootstrap.indexOf('    loadSharedAddGuard();', ownerAddRuntimeIndex);
const listRuntimeIndex = bootstrap.indexOf('    loadList();', sharedAddRuntimeIndex);
assert.ok(coreRuntimeBlockStart >= 0 && ownerAddRuntimeIndex > coreRuntimeBlockStart, 'Owner custom add bridge se nevkládá v core runtime bloku.');
assert.ok(sharedAddRuntimeIndex > ownerAddRuntimeIndex, 'Shared add guard se musí vložit po owner bridge a před shopping-list runtime.');
assert.ok(listRuntimeIndex > sharedAddRuntimeIndex, 'Shared add guard musí být vložen před shopping-list runtime.');

assert.doesNotMatch(html, /<script[^>]+src="assets\/shopping-list\.js/, 'seznam.html nesmí spouštět shopping-list.js napřímo mimo identity bootstrap.');
assert.doesNotMatch(html, /<script[^>]+src="assets\/shopping-insights\.js/, 'seznam.html nesmí spouštět shopping-insights.js napřímo.');
for (const runtimeUrl of [bootstrapUrl, ownerCustomAddUrl, sharedAddGuardUrl, listUrl, insightsUrl]) {
  assert.ok(!worker.includes(`'/${runtimeUrl}'`), `Runtime ${runtimeUrl} se nesmí vrátit do install-time PWA precache.`);
}
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'Shopping runtime skripty musí být obsloužené jako kritické statické assety.');
assert.ok(worker.includes("cache: 'reload'"), 'Shopping runtime skripty musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Shopping runtime skripty musí být po úspěšném načtení uložitelný do runtime cache.');

const functionStart = bootstrap.indexOf('  function installBudgetOwnerBridge()');
const functionEnd = bootstrap.indexOf('\n  function installShareBridge()', functionStart);
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
    search: '',
    hash: shared ? '#share=shared-token' : '',
    reload() { reloads += 1; },
  };
  const window = {
    localStorage: storage,
    supabase:{ createClient() { return { auth }; } },
    SlevaoSupabase:{ getClient() { return { auth }; } },
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
    Promise,
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
  [ownerCustomAddUrl, sharedAddGuardUrl, listUrl, insightsUrl],
  'Shopping runtimy se nenačetly v bezpečném pořadí.'
);
assert.ok(
  scenario.appended.slice(0, 3).every((entry) => entry.owner === 'user-a'),
  'Core shopping runtime musí být vložen okamžitě bez čekání na cloudovou identitu.'
);
assert.equal(
  scenario.appended.at(-1)?.owner,
  'user-b',
  'Insights runtime se vložil dřív, než bootstrap přepnul owner marker na aktuální session user B.'
);
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

console.log('Shopping insights auth, local-first bootstrap and budget scope OK');