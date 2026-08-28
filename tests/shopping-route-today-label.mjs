import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-route-today-label.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-route-today-label.js' });

for (const needle of [
  "const label = date ? `Dnešní trasa · ${date}` : 'Dnešní trasa';",
  "badge.dataset.routeDate = String(api.TODAY || '');",
  "new MutationObserver(sync).observe(results, { childList:true, subtree:true });",
]) assert.ok(source.includes(needle), `Chybí GPS today-label kontrakt: ${needle}`);

const formatStart = source.indexOf('  function formatDateKey(dateKey)');
const formatEnd = source.indexOf('\n  function sync()', formatStart);
assert.ok(formatStart >= 0 && formatEnd > formatStart, 'GPS date formatter nejde izolovaně otestovat.');
const context = { String, Number, Intl, Date };
new Script(`${source.slice(formatStart, formatEnd)}\nglobalThis.label = formatDateKey('2026-08-28');\nglobalThis.invalid = formatDateKey('bad');`, { filename:'shopping-route-date-format.js' }).runInNewContext(context);
assert.match(context.label, /^28\.\s?8\.$/, 'GPS datum se neformátuje česky jako den a měsíc.');
assert.equal(context.invalid, '', 'Neplatný date key nemá vyrábět datumový badge.');

const labelUrl = html.match(/assets\/shopping-route-today-label\.js\?v=[^"']+/)?.[0] || '';
const routeUrl = html.match(/assets\/shopping-route\.js\?v=[^"']+/)?.[0] || '';
const autostartUrl = html.match(/assets\/shopping-route-autostart\.js\?v=[^"']+/)?.[0] || '';
assert.match(labelUrl, /^assets\/shopping-route-today-label\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný GPS today label.');
assert.ok(html.indexOf(routeUrl) < html.indexOf(labelUrl), 'GPS today label musí běžet po shopping-route runtime.');
assert.ok(html.indexOf(labelUrl) < html.indexOf(autostartUrl), 'GPS today label má být připravený před route autostartem.');
assert.ok(worker.includes(`'/${labelUrl}'`), 'PWA necachuje GPS today label ze seznam.html.');

console.log('GPS shopping route result visibly identifies the exact current shopping day');
