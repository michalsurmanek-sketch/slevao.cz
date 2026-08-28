import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-shared-add-submit-guard.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828161211_idempotent_shared_shopping_mutations.sql', root), 'utf8');
const payloadBindingMigration = readFileSync(new URL('supabase/migrations/20260828161930_bind_shared_mutation_id_to_payload.sql', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-shared-add-submit-guard.js' });

for (const needle of [
  "const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));",
  "const sharedMode = Boolean(sharedHash.get('share'));",
  'const RELEASE_TIMEOUT_MS = 15000;',
  'const PENDING_MUTATION_TTL_MS = 5 * 60 * 1000;',
  "const MUTATION_RPC = 'mutate_shared_shopping_list';",
  'const pendingAddMutations = new Map();',
  'function prunePendingMutations(now = Date.now())',
  'pendingAddMutations.get(fingerprint)',
  'pendingAddMutations.set(fingerprint, pending)',
  'function pendingFor(args)',
  'return pendingAddMutations.size;',
  'function installMutationBridge()',
  "args?.p_action !== 'add'",
  'const id = currentMutationId(args);',
  '{ ...args, p_mutation_id:id }',
  'status === 0',
  'status >= 500',
  '/failed to fetch|network|load failed|connection|timeout/i',
  'if (!result?.error || !isAmbiguousFailure(result)) clearPendingMutation(id);',
  'if (!sharedMode || !document.querySelector(\'.sfListLayout\')) return;',
  'function release()',
  'button.disabled = Boolean(nameInput?.disabled);',
  'function begin()',
  "button.setAttribute('aria-busy', 'true');",
  "return !document.querySelector('#listItems .sfLoading');",
  'if (busy) {',
  'event.stopImmediatePropagation();',
  "event.target?.closest?.('#addCustom')",
  "event.key !== 'Enter' || event.target?.id !== 'customName'",
  'new MutationObserver(() =>',
]) {
  assert.ok(source.includes(needle), `Chybí shared add submit/idempotency guard: ${needle}`);
}
assert.ok(!source.includes('new URLSearchParams(location.search)'), 'Shared add guard nesmí znovu přijímat query share token.');

for (const needle of [
  'create table if not exists private.shopping_share_mutations',
  'primary key (share_id, mutation_id)',
  'shopping_share_mutations_list_idx',
  'shopping_share_mutations_item_idx',
  'p_mutation_id uuid,',
  'insert into private.shopping_share_mutations',
  'on conflict (share_id, mutation_id) do nothing',
  'returning mutation_id into v_claimed_mutation',
  'if v_claimed_mutation is null then',
  'if v_existing_action is distinct from p_action then',
  'return public.get_shared_shopping_list(p_token);',
  'set item_id = v_item_id',
  'p_mutation_id => null::uuid',
  'grant execute on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,uuid,text,numeric,text,boolean) to anon, authenticated, service_role',
]) {
  assert.ok(migration.toLowerCase().includes(needle.toLowerCase()), `Chybí serverový shared mutation kontrakt: ${needle}`);
}

for (const needle of [
  'alter table private.shopping_share_mutations',
  'add column request_hash text not null',
  "check (request_hash ~ '^[0-9a-f]{64}$')",
  'v_existing_request_hash text;',
  'v_request_hash text;',
  "'action', 'add'",
  "'product_id', p_product_id",
  "'selected_offer_id', p_selected_offer_id",
  "'custom_name', v_name",
  "'quantity', v_quantity",
  "'unit', v_unit",
  "'is_completed', coalesce(p_is_completed, false)",
  "'action', 'update'",
  "'item_id', p_item_id",
  "'action', 'delete'",
  'encode(extensions.digest(jsonb_build_object(',
  'share_id, mutation_id, action, request_hash, shopping_list_id',
  'select m.action, m.request_hash',
  'v_existing_request_hash is distinct from v_request_hash',
  "raise exception 'Mutation ID už bylo použito s jinými daty.';",
]) {
  assert.ok(payloadBindingMigration.toLowerCase().includes(needle.toLowerCase()), `Chybí payload binding mutation ID: ${needle}`);
}
const payloadHashPos = payloadBindingMigration.indexOf('v_request_hash := encode(extensions.digest');
const claimPos = payloadBindingMigration.indexOf('insert into private.shopping_share_mutations');
const mismatchPos = payloadBindingMigration.indexOf('v_existing_request_hash is distinct from v_request_hash');
const replayReturnPos = payloadBindingMigration.indexOf('return public.get_shared_shopping_list(p_token);', mismatchPos);
assert.ok(payloadHashPos >= 0 && claimPos > payloadHashPos, 'Request hash se musí spočítat před mutation claimem.');
assert.ok(mismatchPos > claimPos && replayReturnPos > mismatchPos, 'Duplicate mutation se musí porovnat s payloadem před idempotentním návratem.');

function createEvent(target) {
  return {
    target,
    prevented:false,
    stopped:false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}

const clickHandlers = [];
const keyHandlers = [];
const observerCallbacks = [];
const attributes = new Map();
const button = {
  disabled:false,
  setAttribute(name, value) { attributes.set(name, value); },
  removeAttribute(name) { attributes.delete(name); },
};
const nameInput = { disabled:false };
const list = {};
const message = { textContent:'' };
const target = { closest(selector) { return selector === '#addCustom' ? button : null; } };

class MutationObserverMock {
  constructor(callback) { observerCallbacks.push(callback); }
  observe() {}
}

const document = {
  querySelector(selector) {
    if (selector === '.sfListLayout') return {};
    if (selector === '#listItems .sfLoading') return null;
    return null;
  },
  getElementById(id) {
    if (id === 'addCustom') return button;
    if (id === 'customName') return nameInput;
    if (id === 'listItems') return list;
    if (id === 'listMessage') return message;
    return null;
  },
  addEventListener(type, callback) {
    if (type === 'click') clickHandlers.push(callback);
    if (type === 'keydown') keyHandlers.push(callback);
  },
};

const rpcCalls = [];
const rpcResults = [];
const db = {
  rpc(fn, args, options) {
    rpcCalls.push({ fn, args:{ ...args }, options });
    return Promise.resolve(rpcResults.shift() || { data:{ ok:true }, error:null, status:200 });
  },
};

let timerId = 0;
const window = {
  SlevaoSupabase:{ getClient() { return db; } },
  setTimeout() { timerId += 1; return timerId; },
};
let uuidCounter = 0;
const crypto = {
  randomUUID() {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  },
};
const context = {
  document,
  window,
  location:{ search:'', hash:'#share=test-token' },
  URLSearchParams,
  MutationObserver:MutationObserverMock,
  clearTimeout() {},
  String,
  Boolean,
  Number,
  JSON,
  Date,
  Math,
  Promise,
  Object,
  Map,
  crypto,
};
new Script(source, { filename:'shared-add-submit-guard-simulation.js' }).runInNewContext(context);

assert.equal(db.__slevaoSharedAddMutationBridge, true, 'RPC mutation bridge se na Supabase klienta nenainstaloval.');
assert.equal(clickHandlers.length, 1, 'Shared guard nezaregistroval click capture handler.');
assert.equal(keyHandlers.length, 1, 'Shared guard nezaregistroval Enter capture handler.');
assert.equal(observerCallbacks.length, 2, 'Shared guard nesleduje render i chybovou zprávu.');

const addPayloadA = {
  p_token:'test-token',
  p_action:'add',
  p_item_id:null,
  p_product_id:null,
  p_selected_offer_id:null,
  p_custom_name:'Rohlíky',
  p_quantity:5,
  p_unit:'ks',
  p_is_completed:false,
};
const addPayloadB = {
  ...addPayloadA,
  p_custom_name:'Chléb',
  p_quantity:1,
};

// A selže nejasně a musí si ponechat mutation ID.
rpcResults.push({ data:null, error:{ message:'TypeError: Failed to fetch' }, status:0 });
const ambiguousA = await db.rpc('mutate_shared_shopping_list', addPayloadA);
assert.ok(ambiguousA.error, 'Simulovaný síťový výpadek A se ztratil.');
const mutationA = rpcCalls.at(-1).args.p_mutation_id;
assert.match(mutationA, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i, 'Shared add A neposílá platné mutation UUID.');
assert.equal(window.SlevaoSharedAddMutationBridge.pendingFor(addPayloadA)?.id, mutationA, 'Nejasný výsledek A nezachoval mutation ID.');
assert.equal(window.SlevaoSharedAddMutationBridge.count(), 1, 'Po prvním nejasném add má být právě jeden pending retry.');

// B selže také nejasně. Nesmí přepsat pending ID položky A.
rpcResults.push({ data:null, error:{ message:'Network timeout' }, status:503 });
const ambiguousB = await db.rpc('mutate_shared_shopping_list', addPayloadB);
assert.ok(ambiguousB.error, 'Simulovaný síťový výpadek B se ztratil.');
const mutationB = rpcCalls.at(-1).args.p_mutation_id;
assert.notEqual(mutationB, mutationA, 'Různé add payloady nesmí sdílet mutation ID.');
assert.equal(window.SlevaoSharedAddMutationBridge.pendingFor(addPayloadA)?.id, mutationA, 'Pending B přepsal mutation ID položky A.');
assert.equal(window.SlevaoSharedAddMutationBridge.pendingFor(addPayloadB)?.id, mutationB, 'Nejasný výsledek B nezachoval vlastní mutation ID.');
assert.equal(window.SlevaoSharedAddMutationBridge.count(), 2, 'Dva nejasné add requesty musí držet dva oddělené pending retry klíče.');

// Retry A musí použít původní A ID a po úspěchu odstranit pouze A.
rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', addPayloadA);
assert.equal(rpcCalls.at(-1).args.p_mutation_id, mutationA, 'Retry A nepoužil původní mutation ID.');
assert.equal(window.SlevaoSharedAddMutationBridge.pendingFor(addPayloadA), null, 'Úspěšný retry A neuvolnil svůj pending klíč.');
assert.equal(window.SlevaoSharedAddMutationBridge.pendingFor(addPayloadB)?.id, mutationB, 'Úspěšný retry A chybně odstranil pending B.');
assert.equal(window.SlevaoSharedAddMutationBridge.count(), 1, 'Po úspěchu A má zůstat pouze pending B.');

// Retry B musí stále použít původní B ID.
rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', addPayloadB);
assert.equal(rpcCalls.at(-1).args.p_mutation_id, mutationB, 'Retry B nepoužil původní mutation ID.');
assert.equal(window.SlevaoSharedAddMutationBridge.count(), 0, 'Po úspěšném retry B musí být pending mapa prázdná.');
assert.equal(window.SlevaoSharedAddMutationBridge.pending(), null, 'Po vyřízení všech retry nesmí zůstat první pending záznam.');

// Nové vědomé přidání A po úspěchu musí dostat nové UUID.
rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', addPayloadA);
const intentionalNextMutationId = rpcCalls.at(-1).args.p_mutation_id;
assert.notEqual(intentionalNextMutationId, mutationA, 'Nové vědomé přidání A po úspěchu recykluje staré mutation ID.');

// Definitivní 4xx chyba mutation ID nedrží.
const addPayloadC = { ...addPayloadA, p_custom_name:'Máslo' };
rpcResults.push({ data:null, error:{ message:'Validation failed' }, status:400 });
await db.rpc('mutate_shared_shopping_list', addPayloadC);
const rejectedMutationId = rpcCalls.at(-1).args.p_mutation_id;
assert.equal(window.SlevaoSharedAddMutationBridge.pendingFor(addPayloadC), null, 'Definitivní 4xx chyba nesmí držet mutation ID pro další pokus.');
rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', addPayloadC);
assert.notEqual(rpcCalls.at(-1).args.p_mutation_id, rejectedMutationId, 'Po definitivní 4xx chybě se musí vytvořit nové mutation ID.');

const first = createEvent(target);
clickHandlers[0](first);
assert.equal(first.prevented, false, 'První shared add nesmí být zastavený.');
assert.equal(first.stopped, false, 'První shared add musí dojít k původnímu handleru.');
assert.equal(button.disabled, true, 'První shared add nezamkl tlačítko proti double submitu.');
assert.equal(attributes.get('aria-busy'), 'true', 'První shared add nemá aria-busy stav.');

const second = createEvent(target);
clickHandlers[0](second);
assert.equal(second.prevented, true, 'Druhý shared add během busy nebyl zastavený.');
assert.equal(second.stopped, true, 'Druhý shared add během busy propadl do původního handleru.');

observerCallbacks[0]();
assert.equal(button.disabled, false, 'Po úspěšném shared renderu se edit tlačítko znovu neodemklo.');
assert.equal(attributes.has('aria-busy'), false, 'Po úspěšném shared renderu zůstal aria-busy stav.');

const third = createEvent(target);
clickHandlers[0](third);
assert.equal(third.prevented, false, 'Po dokončení první operace nejde přidat další položku.');
nameInput.disabled = true;
observerCallbacks[0]();
assert.equal(button.disabled, true, 'View-only shared seznam se po release chybně odemkl.');

const directGuardUrl = html.match(/assets\/shopping-shared-add-submit-guard\.js\?v=[^"']+/)?.[0] || '';
assert.equal(directGuardUrl, 'assets/shopping-shared-add-submit-guard.js?v=20260828-3', 'seznam.html nenačítá concurrent shared add guard v3.');
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.ok(html.indexOf(directGuardUrl) < html.indexOf(bootstrapUrl), 'Shared add bridge musí běžet před shopping bootstrapem.');
assert.ok(worker.includes(`'/${directGuardUrl}'`), 'PWA necachuje concurrent shared add guard v3.');
const shellVersion = Number(worker.match(/CACHE_NAME = 'slevao-shell-20260828-(\d+)'/)?.[1] || 0);
assert.ok(shellVersion >= 69, 'PWA shell nebyl po concurrent shared add fixu posunut na verzi 69+.');

console.log('Shared custom add double-submit, concurrent retries, server idempotency, and payload binding OK');
