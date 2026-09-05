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
  "const rowKind = (row) => row?.source === 'recipe' || row?.is_recipe === true ? 'recipe' : 'manual';",
  'function mergeGuestRows(currentRows, guestRows)',
  'const guestRaw = previousGetItem.call(this, LIST_KEY);',
  "previousSetItem.call(this, LIST_KEY, '[]');",
  'const currentRows = parseRows(previousGetItem.call(this, LIST_KEY));',
  'const claimedRows = mergeGuestRows(currentRows, guestRows);',
  'row[CLAIM_QUANTITY] = Math.max(0.01, Number(source.quantity || 1));',
  'row[CLAIM_COMPLETED] = Boolean(source.completed);',
]) {
  assert.ok(bridge.includes(needle), `Chybí provenance-safe guest claim guard: ${needle}`);
}
for (const needle of [
  'function mergeClaimedState(local, remote)',
  'function resolveClaimRemote(local, remoteById, remoteByKey)',
  'const remote = (serverId ? remoteById.get(serverId) : null) || remoteByKey.get(rowKey(local));',
  'if (rowKind(local) !== rowKind(remote)) return null;',
  'quantity: Math.max(Number(remote?.quantity || 1), claimQuantity)',
  'completed: Boolean(remote?.is_completed && claimCompleted)',
  "String(document.getElementById('listMessage')?.textContent || '').includes('synchronizovaný')",
  ".eq('user_id', session.user.id)",
  ".eq('shopping_list_id', list.id)",
  ".select('id,shopping_list_id,product_id,custom_name,quantity,unit,is_completed,is_recipe')",
  'const remoteById = new Map(',
  'delete local[CLAIM_QUANTITY];',
  'delete local[CLAIM_COMPLETED];',
  'location.reload();',
]) {
  assert.ok(reconcile.includes(needle), `Chybí guest claim reconciliation guard: ${needle}`);
}

const bridgeUrl = 'assets/shopping-guest-claim-bridge.js?v=20260905-1';
const reconcileUrl = 'assets/shopping-guest-claim-reconcile.js?v=20260905-1';
for (const [name, html] of [['seznam.html', listHtml], ['ucet.html', accountHtml]]) {
  assert.ok(html.includes(bridgeUrl), `${name} nenačítá aktuální guest claim bridge.`);
  assert.ok(html.indexOf('assets/public-nav-upgrade.js') < html.indexOf(bridgeUrl), `${name} musí načíst owner bridge před guest claim bridge.`);
}
assert.ok(listHtml.includes(reconcileUrl), 'seznam.html nenačítá aktuální guest claim reconciler.');
assert.ok(listHtml.indexOf('assets/shopping-insights-bootstrap.js') < listHtml.indexOf(reconcileUrl), 'Reconciler se spouští před shopping runtime bootstrapem.');
assert.ok(accountHtml.indexOf(bridgeUrl) < accountHtml.indexOf('assets/account.js'), 'Guest claim bridge se na účtu spouští až po auth runtime.');
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje guest claim assety.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesné verzované guest claim assety.');

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
const nativeStorageGetItem = StorageMock.prototype.getItem;
const nativeStorageSetItem = StorageMock.prototype.setItem;
const nativeStorageRemoveItem = StorageMock.prototype.removeItem;

const LEGACY = 'slevao-shopping-list-v1';
const ACTIVE = 'slevao-active-user-v1';
const USER_KEY = 'slevao-shopping-list-v2:user:user-a';

function runClaim(existingUserRows = [], guestRows = [{ product_id:'milk', quantity:3, completed:false }]) {
  StorageMock.prototype.getItem = nativeStorageGetItem;
  StorageMock.prototype.setItem = nativeStorageSetItem;
  StorageMock.prototype.removeItem = nativeStorageRemoveItem;
  delete StorageMock.prototype.__slevaoShoppingListOwnerBridge;
  delete StorageMock.prototype.__slevaoGuestClaimBridge;

  const localStorage = new StorageMock({ [USER_KEY]:JSON.stringify(existingUserRows) });
  const context = {
    Storage: StorageMock,
    window:{ localStorage },
    localStorage,
    crypto:{ randomUUID:() => '11111111-1111-4111-8111-111111111111' },
    JSON, String, Number, Boolean, Math, Date, Map, Set, Array, Object,
  };
  new Script(`
    const LEGACY_LIST_KEY = '${LEGACY}';
    const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';
    const ACTIVE_USER_KEY = '${ACTIVE}';
    ${ownerFunction}
    installShoppingListOwnerBridge();
  `, { filename:'owner-bridge.js' }).runInNewContext(context);
  new Script(bridge, { filename:'guest-claim-bridge.js' }).runInNewContext(context);
  localStorage.setItem(LEGACY, JSON.stringify(guestRows));
  localStorage.setItem(ACTIVE, 'user-a');
  return JSON.parse(localStorage.map.get(USER_KEY));
}

const claimed = runClaim([{ product_id:'milk', quantity:1, completed:true, server_id:'remote-milk' }]);
assert.equal(claimed.length, 1, 'Guest claim vytvořil duplicitní produkt.');
assert.equal(claimed[0].quantity, 3, 'Owner bridge nezachoval vyšší guest množství v lokálním claimu.');
assert.equal(claimed[0].__slevao_guest_claim_quantity, 3, 'Guest množství nemá jednorázový reconciliation marker.');
assert.equal(claimed[0].__slevao_guest_claim_completed, false, 'Guest dokončení nemá reconciliation marker.');
assert.equal(claimed[0].server_id, 'remote-milk', 'Claim existujícího user řádku zahodil server_id.');

const recipeAgainstManual = runClaim(
  [{
    local_id:'manual-eggs', server_id:'remote-manual-eggs', source:'manual',
    custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', quantity:2, completed:false
  }],
  [{
    local_id:'guest-recipe-eggs', source:'recipe', recipe_id:'rizek', recipe_ids:['rizek'],
    custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', quantity:1, completed:false
  }]
);
assert.equal(recipeAgainstManual.length, 2, 'Guest receptová položka se sloučila s ruční položkou stejného názvu.');
const keptManual = recipeAgainstManual.find((row) => row.source !== 'recipe');
const keptRecipe = recipeAgainstManual.find((row) => row.source === 'recipe');
assert.equal(keptManual?.server_id, 'remote-manual-eggs', 'Ruční cloudový řádek při recipe claimu ztratil server_id.');
assert.equal(keptManual?.quantity, 2, 'Recipe claim změnil množství ručního řádku.');
assert.equal(keptManual?.__slevao_guest_claim_quantity, undefined, 'Ruční řádek dostal marker cizího recipe claimu.');
assert.ok(keptRecipe, 'Guest receptový řádek po přihlášení zmizel.');
assert.equal(keptRecipe?.server_id, undefined, 'Nový receptový řádek nesmí převzít server_id ručního řádku.');
assert.equal(keptRecipe?.__slevao_guest_claim_quantity, 1, 'Receptový claim nemá vlastní reconciliation marker.');

const manualAgainstRecipe = runClaim(
  [{
    local_id:'recipe-eggs', server_id:'remote-recipe-eggs', source:'recipe', recipe_ids:['rizek'],
    custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', quantity:1, completed:false
  }],
  [{
    local_id:'guest-manual-eggs', source:'manual', custom_name:'Vejce (3 ks)', name:'Vejce (3 ks)', quantity:4, completed:false
  }]
);
assert.equal(manualAgainstRecipe.length, 2, 'Guest ruční položka se sloučila s receptovým řádkem stejného názvu.');
const preservedRecipe = manualAgainstRecipe.find((row) => row.source === 'recipe');
const newManual = manualAgainstRecipe.find((row) => row.source !== 'recipe');
assert.equal(preservedRecipe?.server_id, 'remote-recipe-eggs', 'Ruční guest claim přepsal server_id receptového řádku.');
assert.equal(preservedRecipe?.__slevao_guest_claim_quantity, undefined, 'Receptový řádek dostal marker cizího manual claimu.');
assert.equal(newManual?.quantity, 4, 'Ruční guest množství se po odděleném claimu nezachovalo.');
assert.equal(newManual?.__slevao_guest_claim_quantity, 4, 'Ruční guest řádek nemá vlastní claim marker.');

const mergeStart = reconcile.indexOf('  function mergeClaimedState(');
const mergeEnd = reconcile.indexOf('\n  function resolveClaimRemote(', mergeStart);
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

const keyStart = reconcile.indexOf('  const norm =');
const keyEnd = reconcile.indexOf('\n  const readRows =', keyStart);
const resolveStart = reconcile.indexOf('  function resolveClaimRemote(');
const resolveEnd = reconcile.indexOf('\n  async function waitForListSync()', resolveStart);
assert.ok(keyStart >= 0 && keyEnd > keyStart && resolveStart >= 0 && resolveEnd > resolveStart, 'Guest claim identity helpers nejdou izolovaně otestovat.');
const identityContext = { result:null, String, Map, Boolean };
new Script(`
  ${reconcile.slice(keyStart, keyEnd)}
  ${reconcile.slice(resolveStart, resolveEnd)}
  const manualRemote = { id:'manual-id', custom_name:'Vejce (3 ks)', is_recipe:false };
  const recipeRemote = { id:'recipe-id', custom_name:'Vejce (3 ks)', is_recipe:true };
  const remoteById = new Map([['manual-id', manualRemote], ['recipe-id', recipeRemote]]);
  const remoteByKey = new Map([[rowKey(manualRemote), manualRemote], [rowKey(recipeRemote), recipeRemote]]);
  globalThis.result = {
    manualKey:rowKey(manualRemote),
    recipeKey:rowKey(recipeRemote),
    badServerMatch:resolveClaimRemote({ server_id:'manual-id', source:'recipe', custom_name:'Vejce (3 ks)' }, remoteById, remoteByKey),
    goodServerMatch:resolveClaimRemote({ server_id:'recipe-id', source:'recipe', custom_name:'Vejce (3 ks)' }, remoteById, remoteByKey)?.id,
    fallbackRecipe:resolveClaimRemote({ source:'recipe', custom_name:'Vejce (3 ks)' }, new Map(), remoteByKey)?.id,
  };
`, { filename:'guest-claim-provenance-identity.js' }).runInNewContext(identityContext);
assert.notEqual(identityContext.result.manualKey, identityContext.result.recipeKey, 'Manual a recipe custom řádek mají stále stejný guest claim klíč.');
assert.equal(identityContext.result.badServerMatch, null, 'Recipe claim přijal server_id ručního řádku.');
assert.equal(identityContext.result.goodServerMatch, 'recipe-id', 'Recipe claim odmítl správný recipe server_id.');
assert.equal(identityContext.result.fallbackRecipe, 'recipe-id', 'Provenance-aware fallback nenašel správný recipe řádek.');

console.log('Shopping guest claim reconciliation preserves manual/recipe provenance');