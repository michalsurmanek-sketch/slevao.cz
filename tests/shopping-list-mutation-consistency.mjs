import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-list.js' });
new Script(bootstrap, { filename:'assets/shopping-insights-bootstrap.js' });

function section(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Chybí sekce ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.ok(to > from, `Chybí konec sekce ${end}`);
  return source.slice(from, to);
}

assert.match(
  source,
  /const REMOTE_ITEM_FIELDS = 'id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at';/,
  'Synchronizované položky musí používat úplný jednotný seznam remote polí.'
);

const adopt = section('  function adoptRemoteState(row, remote)', '\n\n  async function mergeRemote()');
assert.match(adopt, /row\.server_id = remote\.id;/, 'Adopce serverového stavu musí převzít server_id.');
assert.match(adopt, /row\.selected_offer_id = remote\.selected_offer_id \|\| null;/, 'Adopce serverového stavu musí převzít selected_offer_id.');
assert.match(adopt, /row\.quantity = Number\(remote\.quantity \|\| row\.quantity \|\| 1\);/, 'Adopce serverového stavu musí převzít množství.');
assert.match(adopt, /row\.unit = remote\.unit \|\| row\.unit \|\| 'ks';/, 'Adopce serverového stavu musí převzít jednotku.');
assert.match(adopt, /row\.completed = Boolean\(remote\.is_completed\);/, 'Adopce serverového stavu musí převzít stav koupeno.');
assert.match(adopt, /row\.updated_at = remote\.updated_at \|\| row\.updated_at \|\| null;/, 'Adopce serverového stavu musí převzít updated_at.');

const merge = section('  async function mergeRemote()', '\n  async function persistRow(row, state = row)');
assert.match(merge, /\.select\(REMOTE_ITEM_FIELDS\)/, 'Remote merge musí načíst celý synchronizovaný stav položky přes společný kontrakt polí.');
assert.match(merge, /if \(local\) \{[\s\S]*?adoptRemoteState\(local, item\);/, 'Existující lokální položka musí převzít kompletní serverový stav přes adoptRemoteState.');
assert.match(merge, /insertError\?\.code !== '23505'/, 'Remote merge musí odlišit legitimní souběžný unique konflikt od skutečné chyby.');
assert.match(merge, /const concurrent = await findConcurrentRemoteItem\(row\);/, 'Po souběžném insertu musí merge převzít již existující serverovou položku.');

const persist = section('  async function persistRow(row, state = row)', '\n  async function deleteRow(row)');
assert.match(persist, /\.update\(payload\)[\s\S]*?\.eq\('id', row\.server_id\)[\s\S]*?\.eq\('shopping_list_id', listId\)/, 'Update položky není omezený na aktuální shopping_list_id.');
assert.match(persist, /quantity:\s*Number\(state\.quantity \|\| 1\)/, 'Update nepoužívá snapshot množství konkrétní mutace.');
assert.match(persist, /is_completed:\s*Boolean\(state\.completed\)/, 'Update nepoužívá snapshot stavu koupeno konkrétní mutace.');
assert.match(persist, /error\?\.code !== '23505'/, 'Insert položky musí rozpoznat legitimní souběžný unique konflikt.');
assert.match(persist, /const concurrent = await findConcurrentRemoteItem\(state\);[\s\S]*?adoptRemoteState\(row, concurrent\);/, 'Po souběžném insertu musí persist převzít potvrzený serverový řádek.');

const remove = section('  async function deleteRow(row)', '\n  async function fetchOffers()');
const remoteDelete = remove.indexOf("db.from('shopping_list_items')");
const localDelete = remove.indexOf('rows = rows.filter');
assert.ok(remoteDelete >= 0 && localDelete > remoteDelete, 'Single delete musí potvrdit remote smazání před lokálním odstraněním.');
assert.match(remove, /\.delete\(\)[\s\S]*?\.eq\('id', row\.server_id\)[\s\S]*?\.eq\('shopping_list_id', scopedListId\)/, 'Single delete není omezený na aktuální shopping_list_id.');
assert.ok(remove.indexOf('if (error) throw error;') < localDelete, 'Single delete nesmí lokálně odstranit položku po server erroru.');

const clear = section('  async function clearCompleted()', '\n  async function init()');
const batchDelete = clear.indexOf("db.from('shopping_list_items')");
const batchLocalDelete = clear.indexOf('rows = rows.filter');
assert.ok(batchDelete >= 0 && batchLocalDelete > batchDelete, 'Clear completed musí potvrdit remote batch delete před lokálním odstraněním.');
assert.match(clear, /\.delete\(\)[\s\S]*?\.eq\('shopping_list_id', scopedListId\)[\s\S]*?\.in\('id', ids\)/, 'Batch delete není omezený na aktuální shopping_list_id.');
assert.ok(clear.indexOf('if (error) throw error;') < batchLocalDelete, 'Clear completed musí při remote chybě skončit před lokální mutací.');
assert.ok(clear.indexOf('await waitForRowMutations(completed);') < batchDelete, 'Clear completed musí čekat na rozběhnuté item mutace před batch delete.');

const changeHandler = section("  $('listItems').addEventListener('change'", "\n  $('listItems').addEventListener('click'");
assert.match(changeHandler, /const previous = \{ \.\.\.row \};/, 'Edit položky nemá snapshot pro rollback.');
assert.match(changeHandler, /const desired = \{ \.\.\.row \};/, 'Edit položky nemá snapshot odesílaného cílového stavu.');
assert.match(changeHandler, /await enqueueRowMutation\(row, async \(\) =>/, 'Edit položky nejde přes per-item serializační frontu.');
assert.match(changeHandler, /if \(sharedMode\) await loadSharedList\(\{ silent: true \}\);[\s\S]*?else rollbackToConfirmed\(row, key, version, previous\);/, 'Edit po remote chybě nemá shared reload / confirmed rollback.');

const deleteHandler = section("  $('listItems').addEventListener('click'", '\n\n  init().catch');
assert.match(deleteHandler, /const button = event\.target\.closest\('\[data-delete\]'\);[\s\S]*?if \(!button \|\| button\.disabled\) return;/, 'Delete handler neodmítá již blokovanou akci.');
assert.match(deleteHandler, /deletingRows\.add\(key\);[\s\S]*?await enqueueRowMutation\(row, \(\) => deleteRow\(row\)\);/, 'Delete nezamyká řádek a nečeká ve stejné item frontě.');
assert.match(deleteHandler, /finally \{[\s\S]*?deletingRows\.delete\(key\);[\s\S]*?render\(\);/, 'Delete po dokončení neuvolní row lock a nepřekreslí UI.');

const version = bootstrap.match(/const LIST_URL = 'assets\/shopping-list\.js\?v=([0-9-]+)'/)?.[1] || '';
assert.ok(version, 'Identity bootstrap musí načítat verzovaný shopping-list.js.');
assert.doesNotMatch(html, /<script[^>]+src="assets\/shopping-list\.js/, 'seznam.html nesmí obejít auth gate přímým shopping-list loaderem.');
assert.ok(worker.includes(`'/assets/shopping-list.js?v=${version}'`), 'PWA musí cacheovat stejnou shopping-list.js verzi jako identity bootstrap.');

const bootstrapVersion = html.match(/assets\/shopping-insights-bootstrap\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(bootstrapVersion, 'seznam.html musí načítat verzovaný shopping bootstrap.');
assert.ok(worker.includes(`'/assets/shopping-insights-bootstrap.js?v=${bootstrapVersion}'`), 'PWA musí cacheovat stejnou bootstrap verzi jako seznam.html.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-[0-9a-z-]+';/i, 'PWA shell musí mít verzované cache jméno.');

console.log('Shopping list mutation consistency OK');
