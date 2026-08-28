import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-shared-add-submit-guard.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828161211_idempotent_shared_shopping_mutations.sql', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-shared-add-submit-guard.js' });

for (const needle of [
  "const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));",
  "const sharedMode = Boolean(sharedHash.get('share'));",
  'const RELEASE_TIMEOUT_MS = 15000;',
  'const PENDING_MUTATION_TTL_MS = 5 * 60 * 1000;',
  "const MUTATION_RPC = 'mutate_shared_shopping_list';",
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
  crypto,
};
new Script(source, { filename:'shared-add-submit-guard-simulation.js' }).runInNewContext(context);

assert.equal(db.__slevaoSharedAddMutationBridge, true, 'RPC mutation bridge se na Supabase klienta nenainstaloval.');
assert.equal(clickHandlers.length, 1, 'Shared guard nezaregistroval click capture handler.');
assert.equal(keyHandlers.length, 1, 'Shared guard nezaregistroval Enter capture handler.');
assert.equal(observerCallbacks.length, 2, 'Shared guard nesleduje render i chybovou zprávu.');

const addPayload = {
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

rpcResults.push({ data:null, error:{ message:'TypeError: Failed to fetch' }, status:0 });
const ambiguous = await db.rpc('mutate_shared_shopping_list', addPayload);
assert.ok(ambiguous.error, 'Simulovaný síťový výpadek se ztratil.');
const firstMutationId = rpcCalls.at(-1).args.p_mutation_id;
assert.match(firstMutationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i, 'Shared add neposílá platné mutation UUID.');
assert.equal(window.SlevaoSharedAddMutationBridge.pending()?.id, firstMutationId, 'Nejasný síťový výsledek nezachoval mutation ID pro retry.');

rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', addPayload);
const retryMutationId = rpcCalls.at(-1).args.p_mutation_id;
assert.equal(retryMutationId, firstMutationId, 'Retry stejného add payloadu po Failed to fetch nepoužil stejné mutation ID.');
assert.equal(window.SlevaoSharedAddMutationBridge.pending(), null, 'Úspěšný retry neuvolnil pending mutation ID.');

rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', addPayload);
const intentionalNextMutationId = rpcCalls.at(-1).args.p_mutation_id;
assert.notEqual(intentionalNextMutationId, firstMutationId, 'Nové vědomé přidání po úspěchu chybně recykluje staré mutation ID.');

rpcResults.push({ data:null, error:{ message:'Validation failed' }, status:400 });
await db.rpc('mutate_shared_shopping_list', { ...addPayload, p_custom_name:'Chléb' });
const rejectedMutationId = rpcCalls.at(-1).args.p_mutation_id;
assert.equal(window.SlevaoSharedAddMutationBridge.pending(), null, 'Definitivní 4xx chyba nesmí držet mutation ID pro další pokus.');
rpcResults.push({ data:{ ok:true }, error:null, status:200 });
await db.rpc('mutate_shared_shopping_list', { ...addPayload, p_custom_name:'Chléb' });
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
assert.equal(directGuardUrl, 'assets/shopping-shared-add-submit-guard.js?v=20260828-2', 'seznam.html nenačítá idempotentní shared add guard v2.');
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.ok(html.indexOf(directGuardUrl) < html.indexOf(bootstrapUrl), 'Idempotentní shared add bridge musí běžet před shopping bootstrapem.');
assert.ok(worker.includes(`'/${directGuardUrl}'`), 'PWA necachuje idempotentní shared add guard v2.');
const shellVersion = Number(worker.match(/CACHE_NAME = 'slevao-shell-20260828-(\d+)'/)?.[1] || 0);
assert.ok(shellVersion >= 68, 'PWA shell nebyl po shared add idempotency fixu posunut na verzi 68+.');

console.log('Shared custom add double-submit and server idempotency bridge OK');
