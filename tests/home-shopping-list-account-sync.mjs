import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-filter-range-guard.js', root), 'utf8');

new Script(source, { filename:'assets/home-filter-range-guard.js' });

function section(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Chybí sekce ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.ok(to > from, `Chybí konec sekce ${end}`);
  return source.slice(from, to);
}

const priceGuard = section("  if (minPrice && maxPrice) {", '\n\n  async function publicApi');
assert.match(priceGuard, /min > preset[\s\S]*?minPrice\.value = ''[\s\S]*?dispatchEvent\(new Event\('input'/, 'Původní ochrana cenového rozsahu musí zůstat zachovaná.');

const remoteLookup = section('  async function findRemoteItem', '\n\n  async function addRemoteItem');
assert.match(remoteLookup, /\.eq\('shopping_list_id', listId\)/, 'Vyhledání existující položky musí být omezené na aktivní shopping list.');
assert.match(remoteLookup, /if \(offer\.product_id\)[\s\S]*?\.eq\('product_id', offer\.product_id\)/, 'Produktová položka se musí na serveru hledat podle product_id.');
assert.match(remoteLookup, /\.eq\('selected_offer_id', offer\.id\)/, 'Nesjednocená nabídka se musí nejdřív hledat podle selected_offer_id.');

const remoteAdd = section('  async function addRemoteItem', '\n\n  function alignLocalRow');
assert.match(remoteAdd, /existing\.is_completed \? 1 : Math\.max\(0\.01, Number\(existing\.quantity \|\| 1\)\) \+ 1/, 'Aktivní serverová položka musí dostat přesně +1 a koupená položka se musí znovu aktivovat s množstvím 1.');
assert.match(remoteAdd, /is_completed:false/, 'Přidání z homepage musí výslednou serverovou položku označit jako aktivní.');
assert.match(remoteAdd, /\.update\(payload\)[\s\S]*?\.eq\('id', existing\.id\)[\s\S]*?\.eq\('shopping_list_id', listId\)/, 'Serverový update musí být omezený ID položky i shopping listu.');
assert.match(remoteAdd, /\.insert\(payload\)/, 'Neexistující položka musí být založena na serveru.');

const localAlign = section('  function alignLocalRow', '\n\n  function feedback');
assert.match(localAlign, /active\.server_id = remoteRow\?\.id/, 'Lokální řádek musí převzít server_id potvrzené serverem.');
assert.match(localAlign, /active\.quantity = Math\.max\(0\.01, Number\(remoteRow\?\.quantity/, 'Lokální množství musí převzít potvrzenou serverovou hodnotu.');
assert.match(localAlign, /rows\.filter\(\(row\) => row === active \|\| row\?\.key !== key\)/, 'Lokální duplicitní řádky stejného produktu musí být po synchronizaci sloučené.');

const add = section('  async function addFromHomepage', '\n\n  document.addEventListener');
assert.match(add, /db\.auth\.getSession\(\)/, 'Přidání musí zjistit aktuální session.');
assert.match(add, /if \(!session\?\.user\?\.id\)[\s\S]*?api\.addItemFromOffer\(offer\)/, 'Host musí dál fungovat lokálně bez účtu.');
const remoteWrite = add.indexOf('const remoteRow = await addRemoteItem');
const localWrite = add.indexOf('alignLocalRow(api, offer, remoteRow)');
assert.ok(remoteWrite >= 0 && localWrite > remoteWrite, 'Přihlášený uživatel musí nejdřív potvrdit serverový zápis a teprve potom změnit lokální seznam.');

const click = section("  document.addEventListener('click'", '\n\n  window.__slevaoPriceRangeGuard');
assert.match(click, /event\.target\.closest\('\[data-sf-add\]'\)/, 'Guard musí zachytit tlačítka Přidat do seznamu.');
assert.match(click, /event\.preventDefault\(\);[\s\S]*?event\.stopImmediatePropagation\(\);/, 'Guard musí zabránit původnímu local-only handleru v dvojitém přidání.');
assert.match(click, /addQueue = addQueue[\s\S]*?\.then\(\(\) => addFromHomepage\(button\)\)/, 'Kliknutí musí být serializováno, aby rychlé opakované přidání neztratilo přírůstek.');
assert.match(click, /button\.disabled = true[\s\S]*?finally\(\(\) => \{[\s\S]*?button\.disabled = false/, 'Tlačítko musí být během zápisu blokované a po dokončení znovu povolené.');

assert.match(source, /window\.__slevaoAccountShoppingListAddGuard = true;/, 'Runtime guard musí vystavit diagnostický příznak.');

console.log('Homepage shopping-list account sync OK');