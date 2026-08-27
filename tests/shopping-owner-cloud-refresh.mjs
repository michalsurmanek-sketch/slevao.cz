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
  "if (sharedMode || !document.querySelector('.sfListLayout')) return;",
  "if (checking || document.hidden || editingList()) return;",
  "if (!localIsSettled(localRows)) return;",
  ".eq('user_id', userId)",
  ".eq('is_archived', false)",
  ".eq('shopping_list_id', currentListId)",
  "if (signature(localRows, false) !== signature(remoteRows || [], true))",
  "window.addEventListener('focus', scheduleSoon);",
  "document.addEventListener('visibilitychange'",
  "window.setInterval(() => checkRemote(), POLL_MS)",
  "window.addEventListener('pagehide', () => clearInterval(timer), { once:true });",
]) {
  assert.ok(source.includes(needle), `Chybí owner cloud refresh guard: ${needle}`);
}

const runtimeUrl = 'assets/shopping-owner-cloud-refresh.js?v=20260827-1';
assert.ok(html.includes(runtimeUrl), 'seznam.html nenačítá owner cloud refresh runtime.');
assert.ok(html.indexOf('assets/shopping-insights-bootstrap.js') < html.indexOf(runtimeUrl), 'Cloud refresh se spouští před shopping bootstrapem.');
assert.ok(html.indexOf('assets/shopping-guest-claim-reconcile.js') < html.indexOf(runtimeUrl), 'Cloud refresh se spouští před guest claim reconcilerem.');
assert.ok(worker.includes(`'/${runtimeUrl}'`), 'PWA necachuje owner cloud refresh runtime.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260827-18';/, 'PWA cache verze nebyla zvýšena pro cloud refresh.');

const helpersStart = source.indexOf('  const norm =');
const helpersEnd = source.indexOf('\n  function editingList()', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'Signature helpers nejdou izolovaně otestovat.');
const helpers = source.slice(helpersStart, helpersEnd);
const context = { result:null, String, Number, Boolean, Array, JSON, Math };
new Script(`
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  ${helpers}
  const local = [{ server_id:'row-1', product_id:'milk', selected_offer_id:'offer-a', quantity:3, unit:'ks', completed:false }];
  const remoteSame = [{ id:'row-1', product_id:'milk', selected_offer_id:'offer-a', quantity:3, unit:'ks', is_completed:false }];
  const remoteChanged = [{ id:'row-1', product_id:'milk', selected_offer_id:'offer-a', quantity:4, unit:'ks', is_completed:false }];
  globalThis.result = {
    same: signature(local, false) === signature(remoteSame, true),
    changed: signature(local, false) !== signature(remoteChanged, true),
    settled: localIsSettled(local),
    pendingInsert: localIsSettled([{ product_id:'milk', quantity:1 }]),
    pendingClaim: localIsSettled([{ server_id:'row-1', product_id:'milk', quantity:3, __slevao_guest_claim_quantity:3 }]),
  };
`, { filename:'owner-cloud-refresh-helpers.js' }).runInNewContext(context);

assert.equal(context.result.same, true, 'Stejný potvrzený local/remote stav vyvolá zbytečný reload.');
assert.equal(context.result.changed, true, 'Změna množství z jiného zařízení není detekovaná.');
assert.equal(context.result.settled, true, 'Potvrzený lokální řádek není považovaný za settled.');
assert.equal(context.result.pendingInsert, false, 'Neuložený lokální insert nesmí spustit cloud refresh.');
assert.equal(context.result.pendingClaim, false, 'Guest claim nesmí cloud refresh předběhnout.');

console.log('Shopping owner cloud refresh OK');
