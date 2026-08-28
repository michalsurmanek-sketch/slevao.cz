import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-optimizer-mobile-collapse.js', root), 'utf8');
const css = readFileSync(new URL('assets/shopping-optimizer-mobile-collapse.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-optimizer-mobile-collapse.js' });

for (const needle of [
  "window.matchMedia('(max-width: 720px)')",
  ".filter((box) => box.dataset.dayConsistentPlan !== 'true')",
  "optimizer.querySelector('[data-day-consistent-plan=\"true\"]')",
  'legacy.forEach((box) => { box.hidden = false; });',
  'legacy.forEach((box) => { box.hidden = !expanded; });',
  "toggle.id = 'shoppingLegacyPlansToggle';",
  "toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');",
  "`Další možnosti (${legacy.length})`",
]) assert.ok(source.includes(needle), `Chybí mobile optimizer collapse kontrakt: ${needle}`);

assert.ok(css.includes('#optimizer .sfResultBox[hidden]'), 'CSS neumí skrýt sbalené legacy karty.');
assert.ok(css.includes('#shoppingLegacyPlansToggle'), 'CSS neobsahuje kompaktní toggle dalších možností.');
assert.ok(!source.includes('exact.hidden'), 'Přesný jednodenní plán se nesmí skrývat.');

const cssUrl = html.match(/assets\/shopping-optimizer-mobile-collapse\.css\?v=[^"']+/)?.[0] || '';
const jsUrl = html.match(/assets\/shopping-optimizer-mobile-collapse\.js\?v=[^"']+/)?.[0] || '';
const dayPlanUrl = html.match(/assets\/shopping-day-consistent-plan\.js\?v=[^"']+/)?.[0] || '';
assert.match(cssUrl, /^assets\/shopping-optimizer-mobile-collapse\.css\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzované collapse CSS.');
assert.match(jsUrl, /^assets\/shopping-optimizer-mobile-collapse\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný collapse runtime.');
assert.ok(html.indexOf(dayPlanUrl) < html.indexOf(jsUrl), 'Collapse runtime má běžet až po načtení přesného day-plan runtime.');
assert.ok(worker.includes(`'/${cssUrl}'`), 'PWA necachuje optimizer collapse CSS.');
assert.ok(worker.includes(`'/${jsUrl}'`), 'PWA necachuje optimizer collapse runtime.');

console.log('Mobile optimizer keeps exact plan visible and collapses legacy options safely');
