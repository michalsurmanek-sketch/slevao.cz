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
  'function installBudgetOwnerBridge()',
  "activeUserId() ? `user:${activeUserId()}` : 'guest'",
  'Storage.prototype.getItem = function getItem',
  'Storage.prototype.setItem = function setItem',
  'Storage.prototype.removeItem = function removeItem',
  'const { data, error } = await db.auth.getSession();',
  'const previousMarker = markerUserId();',
  'setMarkerUserId(currentUserId);',
  'if (previousMarker !== currentUserId)',
  'location.reload();',
  "db.auth.onAuthStateChange((event, nextSession) =>",
  "if (!['SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;",
  'if (bootedUserId === null || nextUserId === bootedUserId) return;',
  "window.addEventListener('pagehide', () => authSubscription?.unsubscribe?.(), { once:true });",
]) {
  assert.ok(bootstrap.includes(needle), `Chybí shopping insights identity guard: ${needle}`);
}

assert.match(html, /assets\/shopping-insights-bootstrap\.js\?v=20260822-1/, 'seznam.html nenačítá identity bootstrap.');
assert.doesNotMatch(html, /<script[^>]+src="assets\/shopping-insights\.js/, 'seznam.html nesmí spouštět shopping-insights.js napřímo.');
assert.ok(
  html.indexOf('shopping-list.js?v=20260822-2') < html.indexOf('shopping-insights-bootstrap.js?v=20260822-1'),
  'Bootstrap musí běžet po shopping-list runtime, aby při stale markeru vynutil reload celé shopping vrstvy.'
);
assert.match(worker, /assets\/shopping-insights-bootstrap\.js\?v=20260822-1/, 'PWA necachuje identity bootstrap.');
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

console.log('Shopping insights auth and budget scope OK');
