import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-cloud-refresh.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-cloud-refresh.js' });

for (const needle of [
  "const POLL_MS = 30000;",
  "const VERIFY_ATTEMPTS = 16;",
  "const VERIFY_DELAY_MS = 250;",
  "if (sharedMode || !document.querySelector('.sfListLayout')) return;",
  "if (checking || verifyingCompletion || document.hidden || editingList()) return;",
  "if (requireSettled && !localIsSettled(localRows)) return { status:'pending' };",
  ".eq('user_id', userId)",
  ".eq('is_archived', false)",
  ".eq('shopping_list_id', currentListId)",
  "status: localSignature === remoteSignature ? 'current' : 'mismatch'",
  'function reconcileRemoteRows(localRows, remoteRows)',
  'function persistRemoteState(state)',
  'persistRemoteState(state);',
  'async function verifyBeforeCompletion()',
  "if (lastState.status === 'current' || lastState.status === 'guest') return lastState;",
  "event.target?.closest?.('#completeShopping')",
  'event.preventDefault();',
  'event.stopImmediatePropagation();',
  'const state = await verifyBeforeCompletion();',
  "if (state.status === 'mismatch')",
  "document.addEventListener('click', guardCompletionClick, true);",
  "window.addEventListener('focus', scheduleSoon);",
  "document.addEventListener('visibilitychange'",
  "window.setInterval(() => checkRemote(), POLL_MS)",
  "window.addEventListener('pagehide', () => clearInterval(timer), { once:true });",
]) {
  assert.ok(source.includes(needle), `Chybí owner cloud refresh guard: ${needle}`);
}

const runtimeUrl = 'assets/shopping-owner-cloud-refresh.js?v=20260827-2';
assert.ok(html.includes(runtimeUrl), 'seznam.html nenačítá aktuální owner cloud refresh runtime.');
assert.ok(html.indexOf('assets/shopping-insights-bootstrap.js') < html.indexOf(runtimeUrl), 'Cloud refresh se spouští před shopping bootstrapem.');
assert.ok(html.indexOf('assets/shopping-guest-claim-reconcile.js') < html.indexOf(runtimeUrl), 'Cloud refresh se spouští před guest claim reconcilerem.');
assert.ok(worker.includes(`'/${runtimeUrl}'`), 'PWA necachuje aktuální owner cloud refresh runtime.');
const cacheMatch = worker.match(/const CACHE_NAME = 'slevao-shell-(\d{8})-(\d+)';/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260827 || (cacheDate === 20260827 && cacheRevision >= 20),
  'PWA cache verze je starší než remote deletion reconcile.'
);

const helpersStart = source.indexOf('  const norm =');
const helpersEnd = source.indexOf('\n  function editingList()', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'Signature helpers nejdou izolovaně otestovat.');
const helpers = source.slice(helpersStart, helpersEnd);
const context = { result:null, String, Number, Boolean, Array, JSON, Math, Map };
new Script(`
  const LIST_KEY = 'slevao-shopping-list-v1';
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const localStorage = { getItem(){ return null; }, setItem(){} };
  const window = { SlevaoPublic:null };
  ${helpers}
  const local = [{ server_id:'row-1', product_id:'milk', selected_offer_id:'offer-a', quantity:3, unit:'ks', completed:false, name:'Mléko' }];
  const remoteSame = [{ id:'row-1', product_id:'milk', selected_offer_id:'offer-a', quantity:3, unit:'ks', is_completed:false }];
  const remoteChanged = [{ id:'row-1', product_id:'milk', selected_offer_id:'offer-a', quantity:4, unit:'ks', is_completed:false }];
  const unsynced = [{ local_id:'local-new', product_id:'bread', quantity:2, unit:'ks', completed:false, name:'Chléb' }];
  const reconciledChanged = reconcileRemoteRows(local, remoteChanged);
  const reconciledDeleted = reconcileRemoteRows(local, []);
  const reconciledPending = reconcileRemoteRows(unsynced, []);
  globalThis.result = {
    same: signature(local, false) === signature(remoteSame, true),
    changed: signature(local, false) !== signature(remoteChanged, true),
    settled: localIsSettled(local),
    pendingInsert: localIsSettled([{ product_id:'milk', quantity:1 }]),
    pendingClaim: localIsSettled([{ server_id:'row-1', product_id:'milk', quantity:3, __slevao_guest_claim_quantity:3 }]),
    changedQuantity: reconciledChanged[0]?.quantity,
    deletedCount: reconciledDeleted.length,
    pendingCount: reconciledPending.length,
  };
`, { filename:'owner-cloud-refresh-helpers.js' }).runInNewContext(context);

assert.equal(context.result.same, true, 'Stejný potvrzený local/remote stav vyvolá zbytečný reload.');
assert.equal(context.result.changed, true, 'Změna množství z jiného zařízení není detekovaná.');
assert.equal(context.result.settled, true, 'Potvrzený lokální řádek není považovaný za settled.');
assert.equal(context.result.pendingInsert, false, 'Neuložený lokální insert nesmí spustit cloud refresh.');
assert.equal(context.result.pendingClaim, false, 'Guest claim nesmí cloud refresh předběhnout.');
assert.equal(context.result.changedQuantity, 4, 'Remote změna množství se před reloadem nepropsala do lokálního snapshotu.');
assert.equal(context.result.deletedCount, 0, 'Serverově smazaný řádek by se po reloadu znovu vytvořil.');
assert.equal(context.result.pendingCount, 1, 'Neuložený lokální řádek se při reconcile nesmí zahodit.');

const verifyStart = source.indexOf('  async function verifyBeforeCompletion()');
const verifyEnd = source.indexOf('\n  async function guardCompletionClick', verifyStart);
assert.ok(verifyStart >= 0 && verifyEnd > verifyStart, 'Completion verifier nejde izolovaně otestovat.');
const verifyFunction = source.slice(verifyStart, verifyEnd);

async function runVerify(states) {
  const verifyContext = {
    result:null,
    calls:0,
    Promise,
    setTimeout(callback) { callback(); return 1; },
  };
  new Script(`
    const VERIFY_ATTEMPTS = 3;
    const VERIFY_DELAY_MS = 0;
    const states = ${JSON.stringify(states)};
    let index = 0;
    async function snapshotState() {
      globalThis.calls += 1;
      return states[Math.min(index++, states.length - 1)];
    }
    ${verifyFunction}
    globalThis.promise = verifyBeforeCompletion();
  `, { filename:'owner-cloud-completion-verify.js' }).runInNewContext(verifyContext);
  verifyContext.result = await verifyContext.promise;
  return verifyContext;
}

const pendingThenCurrent = await runVerify([{ status:'pending' }, { status:'current' }]);
assert.equal(pendingThenCurrent.result.status, 'current', 'Completion guard nepočkal na dokončení lokální mutace.');
assert.equal(pendingThenCurrent.calls, 2, 'Completion guard zbytečně pokračoval po dosažení current stavu.');

const remoteMismatch = await runVerify([{ status:'mismatch' }]);
assert.equal(remoteMismatch.result.status, 'mismatch', 'Trvalý remote mismatch byl chybně považovaný za aktuální seznam.');
assert.equal(remoteMismatch.calls, 3, 'Completion guard nevyužil omezené čekací okno pro doběhnutí lokální mutace.');

const guest = await runVerify([{ status:'guest' }]);
assert.equal(guest.result.status, 'guest', 'Guest nákup byl chybně blokovaný cloudovým guardem.');
assert.equal(guest.calls, 1, 'Guest dokončení nemá čekat na cloudový stav.');

console.log('Shopping owner cloud refresh and completion guard OK');
