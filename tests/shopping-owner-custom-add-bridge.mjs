import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const bridge = readFileSync(new URL('assets/shopping-owner-custom-add-bridge.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');

for (const needle of [
  "const ACTIVE_USER_KEY = 'slevao-active-user-v1';",
  'const PENDING_ATTEMPTS = 16;',
  'const PENDING_DELAY_MS = 250;',
  'const sharedMode = Boolean(',
  "if (sharedMode || !document.querySelector('.sfListLayout')) return;",
  'function markedUserId()',
  'function pendingDeleteMutation()',
  "document.querySelector('#listItems [data-delete]:disabled')",
  'async function waitForPendingDeletes()',
  'function lockMutationControls()',
  "'#listItems input, #listItems button, #customName, #customQuantity, #addCustom, #clearCompleted'",
  'function restoreMutationControls(state)',
  'async function verifyCurrentOwnerState()',
  'window.SlevaoOwnerCloudRefresh?.verifyBeforeCompletion',
  'await db.auth.getSession()',
  'const pendingDeletesSettled = await waitForPendingDeletes();',
  'controlState = lockMutationControls();',
  'const state = await verifyCurrentOwnerState();',
  "if (state.status !== 'current')",
  "db.rpc('add_own_shopping_list_custom_item'",
  'p_custom_name: name',
  'p_quantity: quantity',
  "p_unit: 'ks'",
  'p_mutation_id: mutationId',
  'createMutationId()',
  'location.reload();',
]) {
  assert.ok(bridge.includes(needle), `Chybí owner custom add bridge guard: ${needle}`);
}

assert.match(bridge, /if \(bypass \|\| !markedUserId\(\)\) return;/, 'Guest click se nesmí zachytávat owner bridgem.');
assert.match(bridge, /if \(bypass \|\| !markedUserId\(\) \|\| event\.key !== 'Enter'/, 'Guest Enter se nesmí zachytávat owner bridgem.');
assert.match(bridge, /if \(!session\?\.user\?\.id\)[\s\S]*forwardOriginal\(source\);/, 'Session race se nevrací k původnímu addCustom handleru.');
assert.match(bridge, /event\.stopImmediatePropagation\(\);[\s\S]*addOwnerCustom\('click'\);/, 'Owner click může propadnout do starého handleru.');
assert.match(bridge, /event\.key !== 'Enter'[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*addOwnerCustom\('enter'\);/, 'Owner Enter může propadnout do starého handleru.');
assert.ok(!bridge.includes("db.from('shopping_list_items')"), 'Bridge nesmí znovu zavádět přímý owner INSERT/UPDATE race.');

const pendingWait = bridge.indexOf('const pendingDeletesSettled = await waitForPendingDeletes();');
const controlsLock = bridge.indexOf('controlState = lockMutationControls();', pendingWait);
const cloudVerify = bridge.indexOf('const state = await verifyCurrentOwnerState();', controlsLock);
const stateGuard = bridge.indexOf("if (state.status !== 'current')", cloudVerify);
const rpc = bridge.indexOf("db.rpc('add_own_shopping_list_custom_item'", stateGuard);
const reload = bridge.indexOf('location.reload();', rpc);
assert.ok(pendingWait >= 0 && controlsLock > pendingWait, 'Ovládání se zamyká před doběhnutím staršího delete requestu.');
assert.ok(cloudVerify > controlsLock, 'Cloud snapshot se ověřuje před zablokováním nových lokálních změn.');
assert.ok(stateGuard > cloudVerify && rpc > stateGuard, 'Owner RPC může běžet bez potvrzeného current cloud stavu.');
assert.ok(reload > rpc, 'Reload může proběhnout před atomickým owner add RPC.');

assert.match(bootstrap, /const OWNER_CUSTOM_ADD_URL = 'assets\/shopping-owner-custom-add-bridge\.js\?v=[0-9-]+';/, 'Bootstrap nemá verzovaný owner-add bridge.');
const bridgeLoad = bootstrap.indexOf('loadOwnerCustomAddBridge();');
const listLoad = bootstrap.indexOf('loadList();', bridgeLoad + 1);
assert.ok(bridgeLoad >= 0 && listLoad > bridgeLoad, 'Owner-add bridge se musí načíst před shopping-list.js.');

console.log('Atomic owner custom add bridge contract OK');
