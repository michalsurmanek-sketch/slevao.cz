import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const nav = readFileSync(new URL('assets/public-nav-upgrade.js', root), 'utf8');
const bridge = readFileSync(new URL('assets/shopping-guest-claim-bridge.js', root), 'utf8');
const reconcile = readFileSync(new URL('assets/shopping-guest-claim-reconcile.js', root), 'utf8');
const listHtml = readFileSync(new URL('seznam.html', root), 'utf8');
const accountHtml = readFileSync(new URL('ucet.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(bridge, { filename:'assets/shopping-guest-claim-bridge.js' });
new Script(reconcile, { filename:'assets/shopping-guest-claim-reconcile.js' });

for (const needle of [
  "const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';",
  "const CLAIM_COMPLETED = '__slevao_guest_claim_completed';",
  'const guestRows = parseRows(previousGetItem.call(this, LIST_KEY));',
  'const result = previousSetItem.call(this, key, value);',
  'row[CLAIM_QUANTITY] = Math.max(0.01, Number(source.quantity || 1));',
  'row[CLAIM_COMPLETED] = Boolean(source.completed);',
]) {
  assert.ok(bridge.includes(needle), `Chybí guest claim marker guard: ${needle}`);
}
for (const needle of [
  'function mergeClaimedState(local, remote)',
  'quantity: Math.max(Number(remote?.quantity || 1), claimQuantity)',
  'completed: Boolean(remote?.is_completed && claimCompleted)',
  "String(document.getElementById('listMessage')?.textContent || '').includes('synchronizovaný')",
  ".eq('user_id', session.user.id)",
  ".eq('shopping_list_id', list.id)",
  'delete currentLocal[CLAIM_QUANTITY];',
  'delete currentLocal[CLAIM_COMPLETED];',
  'location.reload();',
]) {
  assert.ok(reconcile.includes(needle), `Chybí guest claim reconciliation guard: ${needle}`);
}

const bridgeUrl = 'assets/shopping-guest-claim-bridge.js?v=20260827-1';
const reconcileUrl = 'assets/shopping-guest-claim-reconcile.js?v=20260827-1';
for (const [name, html] of [['seznam.html', listHtml], ['ucet.html', accountHtml]]) {
  assert.ok(html.includes(bridgeUrl), `${name} nenačítá guest claim bridge.`);
  assert.ok(html.indexOf('assets/public-nav-upgrade.js') < html.indexOf(bridgeUrl), `${name} musí načíst owner bridge před guest claim bridge.`);
}
assert.ok(listHtml.includes(reconcileUrl), 'seznam.html nenačítá guest claim reconciler.');
assert.ok(listHtml.indexOf('assets/shopping-insights-bootstrap.js') < listHtml.indexOf(reconcileUrl), 'Reconciler se spouští před shopping runtime bootstrapem.');
assert.ok(accountHtml.indexOf(bridgeUrl) < accountHtml.indexOf('assets/account.js'), 'Guest claim bridge se na účtu spouští až po auth runtime.');
assert.ok(worker.includes(`'/${bridgeUrl}'`), 'PWA necachuje guest claim bridge.');
assert.ok(worker.includes(`'/${reconcileUrl}'`), 'PWA necachuje guest claim reconciler.');

const ownerStart = nav.indexOf('  function installShoppingListOwnerBridge()');
const ownerEnd = nav.indexOf('\n  function loadPersonalization()', ownerStart);
assert.ok(ownerStart >= 0 && ownerEnd > ownerStart, 'Owner bridge nejde izolovaně otestovat.');
const ownerFunction = nav.slice(ownerStart, ownerEnd);

class StorageMock {
  constructor(values = {}) { this.map = new Map(Object.entries(values)); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

const LEGACY = 'slevao-shopping-list-v1';
const ACTIVE = 'slevao-active-user-v1';
const USER_KEY = 'slevao-shopping-list-v2:user:user-a';

function runClaim(existingUserRows = []) {
  const localStorage = new StorageMock({ [USER_KEY]:JSON.stringify(existingUserRows) });
  const context = {
    Storage: StorageMock,
    window:{ localStorage },
    localStorage,
    crypto:{ randomUUID:() => '11111111-1111-4111-8111-111111111111' },
    JSON, String, Number, Boolean, Math, Date, Map, Array, Object,
  };
  new Script(`
    const LEGACY_LIST_KEY = '${LEGACY}';
    const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';
    const ACTIVE_USER_KEY = '${ACTIVE}';
    ${ownerFunction}
    installShoppingListOwnerBridge();
  `, { filename:'owner-bridge.js' }).runInNewContext(context);
  new Script(bridge, { filename:'guest-claim-bridge.js' }).runInNewContext(context);
  localStorage.setItem(LEGACY, JSON.stringify([{ product_id:'milk', quantity:3, completed:false }]));
  localStorage.setItem(ACTIVE, 'user-a');
  return JSON.parse(localStorage.map.get(USER_KEY));
}

const claimed = runClaim([{ product_id:'milk', quantity:1, completed:true, server_id:'remote-milk' }]);
assert.equal(claimed.length, 1, 'Guest claim vytvořil duplicitní produkt.');
assert.equal(claimed[0].quantity, 3, 'Owner bridge nezachoval vyšší guest množství v lokálním claimu.');
assert.equal(claimed[0].__slevao_guest_claim_quantity, 3, 'Guest množství nemá jednorázový reconciliation marker.');
assert.equal(claimed[0].__slevao_guest_claim_completed, false, 'Guest dokončení nemá reconciliation marker.');
assert.equal(claimed[0].server_id, 'remote-milk', 'Claim existujícího user řádku zahodil server_id.');

const mergeStart = reconcile.indexOf('  function mergeClaimedState(');
const mergeEnd = reconcile.indexOf('\n  async function waitForListSync()', mergeStart);
assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'mergeClaimedState nejde izolovaně otestovat.');
const mergeFunction = reconcile.slice(mergeStart, mergeEnd);
const mergeContext = { result:null, Number, Boolean, Math };
new Script(`
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const CLAIM_COMPLETED = '__slevao_guest_claim_completed';
  ${mergeFunction}
  globalThis.result = [
    mergeClaimedState({ __slevao_guest_claim_quantity:3, __slevao_guest_claim_completed:false }, { quantity:1, is_completed:true }),
    mergeClaimedState({ __slevao_guest_claim_quantity:3, __slevao_guest_claim_completed:false }, { quantity:5, is_completed:false }),
    mergeClaimedState({ __slevao_guest_claim_quantity:2, __slevao_guest_claim_completed:true }, { quantity:1, is_completed:true })
  ];
`, { filename:'guest-claim-merge-state.js' }).runInNewContext(mergeContext);
const [guestWins, cloudWins, bothCompleted] = mergeContext.result;
assert.deepEqual({ ...guestWins }, { quantity:3, completed:false }, 'Cloud 1× + guest 3× se nesloučilo na 3× aktivní položku.');
assert.deepEqual({ ...cloudWins }, { quantity:5, completed:false }, 'Cloud 5× byl chybně snížen guest claimem 3×.');
assert.deepEqual({ ...bothCompleted }, { quantity:2, completed:true }, 'Dokončení se nezachovalo, když byly dokončené oba zdroje.');

console.log('Shopping guest claim reconciliation OK');
