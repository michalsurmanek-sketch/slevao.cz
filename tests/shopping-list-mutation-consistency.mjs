import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-list.js' });

function section(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Chybí sekce ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.ok(to > from, `Chybí konec sekce ${end}`);
  return source.slice(from, to);
}

const persist = section('  async function persistRow(row, state = row)', '\n  async function deleteRow(row)');
assert.match(persist, /\.update\(payload\)[\s\S]*?\.eq\('id', row\.server_id\)[\s\S]*?\.eq\('shopping_list_id', listId\)/, 'Update položky není omezený na aktuální shopping_list_id.');
assert.match(persist, /quantity:\s*Number\(state\.quantity \|\| 1\)/, 'Update nepoužívá snapshot množství konkrétní mutace.');
assert.match(persist, /is_completed:\s*Boolean\(state\.completed\)/, 'Update nepoužívá snapshot stavu koupeno konkrétní mutace.');

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

const version = html.match(/assets\/shopping-list\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(version, 'seznam.html musí načítat verzovaný shopping-list.js.');
assert.ok(worker.includes(`'/assets/shopping-list.js?v=${version}'`), 'PWA musí cacheovat stejnou shopping-list.js verzi jako seznam.html.');

console.log('Shopping list mutation consistency OK');
