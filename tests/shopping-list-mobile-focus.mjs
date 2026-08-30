import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('assets/shopping-list-mobile-focus.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

for (const needle of [
  '@media (max-width:720px)',
  '.listHeroMain > .sfMuted:not(#accountStatus)',
  '.listBenefits',
  'display:none',
  '#accountStatus',
  '#accountStatus:empty',
  '.listHeroSide .sfButton',
  '@media (max-width:350px)',
  '#listItems .sfItemThumb',
  '#listItems .sfItemMeta',
  'display:none!important',
]) assert.ok(css.includes(needle), `Chybí mobile-focus kontrakt: ${needle}`);

assert.ok(!css.includes('#accountStatus{display:none'), 'Stav účtu se na mobilu nesmí bezpodmínečně skrýt.');
assert.ok(!css.includes('#shareList{display:none'), 'Sdílení seznamu se na mobilu nesmí skrýt.');
assert.ok(!css.includes('#clearCompleted{display:none'), 'Odstranění koupených se na mobilu nesmí skrýt.');
assert.ok(!css.includes('.listHeroSide{display:none'), 'Souhrn seznamu se na mobilu nesmí skrýt.');

const focusUrl = html.match(/assets\/shopping-list-mobile-focus\.css\?v=[^"']+/)?.[0] || '';
const redesignUrl = html.match(/assets\/shopping-list-redesign\.css\?v=[^"']+/)?.[0] || '';
const summaryUrl = html.match(/assets\/shopping-list-price-summary-v2\.css\?v=[^"']+/)?.[0] || '';
assert.match(focusUrl, /^assets\/shopping-list-mobile-focus\.css\?v=\d{8}-\d+$/, 'seznam.html nenačítá verzovaný mobile-focus CSS.');
assert.ok(html.indexOf(redesignUrl) < html.indexOf(focusUrl), 'Mobile-focus CSS musí přepsat základní redesign až po jeho načtení.');
assert.ok(html.indexOf(summaryUrl) < html.indexOf(focusUrl), 'Mobile-focus CSS musí být poslední list layout override.');
assert.ok(worker.includes(`'/${focusUrl}'`), 'PWA shell necachuje mobile-focus CSS.');

console.log('Shopping list mobile hero and 320px focus layout OK');
