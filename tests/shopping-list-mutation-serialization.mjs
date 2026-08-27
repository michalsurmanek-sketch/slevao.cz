import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const listHtml = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

for (const needle of [
  'const rowMutationQueues = new Map();',
  'const rowMutationVersions = new Map();',
  'const rowConfirmedStates = new Map();',
  'const deletingRows = new Set();',
  'async function persistRow(row, state = row)',
  'await enqueueRowMutation(row, async () =>',
  'await enqueueRowMutation(row, () => deleteRow(row))',
  'await waitForRowMutations(completed);',
  'deletingRows.has(mutationKey(row))',
  'rememberConfirmedState(row, { ...row })',
  'rollbackToConfirmed(row, key, version, previous)',
]) {
  assert.ok(source.includes(needle), `Chybí serializační guard nákupního seznamu: ${needle}`);
}

assert.match(source, /quantity:\s*Number\(state\.quantity \|\| 1\)/, 'Persist nepoužívá snapshot množství zachycený při akci.');
assert.match(source, /is_completed:\s*Boolean\(state\.completed\)/, 'Persist nepoužívá snapshot stavu koupeno zachycený při akci.');
assert.match(source, /await persistRow\(row, desired\);[\s\S]*?rememberConfirmedState\(row, \{ \.\.\.row \}\)/, 'Potvrzený snapshot musí po persistu vycházet ze serverem adoptovaného stavu řádku.');
assert.ok(
  source.indexOf('await waitForRowMutations(completed);') < source.indexOf(".delete()\n            .eq('shopping_list_id', scopedListId)"),
  'Hromadné mazání musí čekat na rozběhnuté mutace před server delete.'
);

const versionMatch = bootstrap.match(/const LIST_URL = 'assets\/shopping-list\.js\?v=([0-9-]+)'/);
assert.ok(versionMatch, 'Identity bootstrap nemá verzovaný shopping-list runtime.');
assert.doesNotMatch(listHtml, /<script[^>]+src="assets\/shopping-list\.js/, 'seznam.html nesmí obejít identity bootstrap přímým shopping-list loaderem.');
assert.match(worker, new RegExp(`assets/shopping-list\\.js\\?v=${versionMatch[1]}`), 'PWA nemá stejnou shopping-list runtime verzi jako identity bootstrap.');

const helperStart = source.indexOf('  function mutationKey(row)');
const helperEnd = source.indexOf('\n  function productSignature', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Serializační helpery nejdou izolovaně otestovat.');
const helpers = source.slice(helperStart, helperEnd);

const context = { Map, Set, Promise, String, Number, Object, Array };
new Script(`
  const rowMutationQueues = new Map();
  const rowMutationVersions = new Map();
  const rowConfirmedStates = new Map();
  const deletingRows = new Set();
  function rowKey(row) { return row?.key || 'fallback'; }
  function render() {}
  ${helpers}
  globalThis.__api = {
    enqueueRowMutation,
    waitForRowMutations,
    nextMutationVersion,
    rememberConfirmedState,
    rollbackToConfirmed,
    rowMutationQueues
  };
`, { filename:'shopping-list-mutation-helpers.js' }).runInNewContext(context);

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const api = context.__api;
const row = { local_id:'row-a', server_id:'server-a', quantity:1, completed:false };
const order = [];
let releaseFirst;
const first = api.enqueueRowMutation(row, async () => {
  order.push('first-start');
  await new Promise((resolve) => { releaseFirst = resolve; });
  order.push('first-end');
});
const second = api.enqueueRowMutation(row, async () => {
  order.push('second-start');
  order.push('second-end');
});
await flushMicrotasks();
assert.deepEqual(order, ['first-start'], 'Druhá mutace stejné položky odstartovala paralelně.');
releaseFirst();
await Promise.all([first, second]);
assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end'], 'Mutace stejné položky nejsou FIFO.');

const recoveryOrder = [];
const failed = api.enqueueRowMutation(row, async () => {
  recoveryOrder.push('failed');
  throw new Error('expected');
});
const afterFailure = api.enqueueRowMutation(row, async () => {
  recoveryOrder.push('after-failure');
});
await assert.rejects(failed, /expected/);
await afterFailure;
assert.deepEqual(recoveryOrder, ['failed', 'after-failure'], 'Chyba jedné mutace zablokovala následující změnu.');

let releaseWait;
const pending = api.enqueueRowMutation(row, () => new Promise((resolve) => { releaseWait = resolve; }));
let waitFinished = false;
const waiting = api.waitForRowMutations([row]).then(() => { waitFinished = true; });
await flushMicrotasks();
assert.equal(waitFinished, false, 'waitForRowMutations nečeká na aktivní frontu položky.');
releaseWait();
await Promise.all([pending, waiting]);
assert.equal(waitFinished, true, 'waitForRowMutations nedokončil čekání po vyprázdnění fronty.');

const confirmed = { ...row, quantity:2 };
api.rememberConfirmedState(row, confirmed);
const firstVersion = api.nextMutationVersion(row);
const secondVersion = api.nextMutationVersion(row);
row.quantity = 3;
api.rollbackToConfirmed(row, firstVersion.key, firstVersion.version, { ...row, quantity:1 });
assert.equal(row.quantity, 3, 'Starší selhaná mutace přepsala novější lokální změnu.');
api.rollbackToConfirmed(row, secondVersion.key, secondVersion.version, { ...row, quantity:1 });
assert.equal(row.quantity, 2, 'Poslední selhaná mutace se nevrátila na serverem potvrzený snapshot.');

console.log('Shopping list mutation serialization OK');
