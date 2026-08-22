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

const persist = section('  async function persistRow(row)', '\n  async function deleteRow(row)');
assert.match(persist, /\.update\(payload\)[\s\S]*?\.eq\('id', row\.server_id\)[\s\S]*?\.eq\('shopping_list_id', listId\)/, 'Update položky není omezený na aktuální shopping_list_id.');

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
assert.match(clear, /if \(error\) \{[\s\S]*?showMessage\([\s\S]*?return;[\s\S]*?\}/, 'Clear completed musí při remote chybě skončit před lokální mutací.');

const changeHandler = section("  $('listItems').addEventListener('change'", "\n  $('listItems').addEventListener('click'");
assert.match(changeHandler, /const previous = \{ \.\.\.row \};/, 'Edit položky nemá snapshot pro rollback.');
assert.match(changeHandler, /catch \(error\)[\s\S]*?if \(sharedMode\)[\s\S]*?else \{[\s\S]*?Object\.assign\(row, previous\);[\s\S]*?render\(\);/, 'Non-shared edit se po remote chybě nevrací na předchozí stav.');

const deleteHandler = section("  $('listItems').addEventListener('click'", '\n\n  init().catch');
assert.match(deleteHandler, /const button = event\.target\.closest\('\[data-delete\]'\);[\s\S]*?if \(!button \|\| button\.disabled\) return;[\s\S]*?button\.disabled = true;/, 'Delete tlačítko neblokuje paralelní kliknutí.');
assert.match(deleteHandler, /catch \(error\) \{[\s\S]*?if \(button\.isConnected\) button\.disabled = false;/, 'Delete tlačítko se po chybě neodemkne.');

const version = html.match(/assets\/shopping-list\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(version, 'seznam.html musí načítat verzovaný shopping-list.js.');
assert.ok(worker.includes(`'/assets/shopping-list.js?v=${version}'`), 'PWA musí cacheovat stejnou shopping-list.js verzi jako seznam.html.');

console.log('Shopping list mutation consistency OK');
