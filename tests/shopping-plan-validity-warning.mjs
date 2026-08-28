import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-plan-validity-warning.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
const css = readFileSync(new URL('assets/mobile-optimizer-compact.css', root), 'utf8');

new Script(source, { filename:'assets/shopping-plan-validity-warning.js' });

for (const needle of [
  "const WARNING = 'Jednotlivé akce nemusí platit ve stejný den.';",
  'const futurePattern = /používá akci začínající během příštích 7 dnů/i;',
  "optimizer.querySelectorAll('.sfResultBox').forEach((box) =>",
  "box.classList.toggle('hasMixedDateWarning', hasFuture);",
  'if (!hasFuture || original.includes(WARNING)) return;',
  'note.textContent = `${original} ${WARNING}`;',
  "new MutationObserver(schedule).observe(optimizer, { childList:true, subtree:true });",
  'requestAnimationFrame(() =>',
]) {
  assert.ok(source.includes(needle), `Chybí mixed-date warning kontrakt: ${needle}`);
}

const boxWithFuture = {
  classList:{ values:new Map(), toggle(name, value) { this.values.set(name, value); } },
  note:{ textContent:'Nejnižší cena. 1 položek používá akci začínající během příštích 7 dnů.' },
  querySelector(selector) { return selector === ':scope > .sfMuted' ? this.note : null; },
};
const boxCurrent = {
  classList:{ values:new Map(), toggle(name, value) { this.values.set(name, value); } },
  note:{ textContent:'Všechny ceny platí dnes.' },
  querySelector(selector) { return selector === ':scope > .sfMuted' ? this.note : null; },
};
const optimizer = { querySelectorAll() { return [boxWithFuture, boxCurrent]; } };
const syncStart = source.indexOf('  function syncWarnings()');
const syncEnd = source.indexOf('\n  function schedule()', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, 'syncWarnings nejde izolovaně otestovat.');
const syncFunction = source.slice(syncStart, syncEnd);
new Script(`
  const WARNING = 'Jednotlivé akce nemusí platit ve stejný den.';
  const futurePattern = /používá akci začínající během příštích 7 dnů/i;
  ${syncFunction}
  syncWarnings();
  syncWarnings();
`, { filename:'mixed-date-warning-simulation.js' }).runInNewContext({ optimizer, String });
assert.equal(boxWithFuture.classList.values.get('hasMixedDateWarning'), true, 'Budoucí plán není označený mixed-date třídou.');
assert.equal(boxCurrent.classList.values.get('hasMixedDateWarning'), false, 'Aktuální plán je chybně označený mixed-date třídou.');
assert.equal((boxWithFuture.note.textContent.match(/Jednotlivé akce nemusí platit ve stejný den\./g) || []).length, 1, 'Desktop warning se duplikuje při opakovaném renderu.');
assert.equal(boxCurrent.note.textContent, 'Všechny ceny platí dnes.', 'Current-only plán byl zbytečně změněn.');

assert.ok(css.includes('Akce nemusí platit ve stejný den'), 'Mobilní optimizer neobsahuje mixed-date warning.');
assert.match(html, /assets\/shopping-plan-validity-warning\.js\?v=20260828-[0-9]+/, 'seznam.html nenačítá mixed-date warning runtime.');
assert.match(html, /assets\/mobile-optimizer-compact\.css\?v=20260828-[0-9]+/, 'seznam.html nenačítá verzovaný mobilní optimizer CSS.');
const warningUrl = html.match(/assets\/shopping-plan-validity-warning\.js\?v=[^"']+/)?.[0];
const cssUrl = html.match(/assets\/mobile-optimizer-compact\.css\?v=[^"']+/)?.[0];
assert.ok(warningUrl && worker.includes(`'/${warningUrl}'`), 'PWA necachuje přesný mixed-date warning runtime ze seznam.html.');
assert.ok(cssUrl && worker.includes(`'/${cssUrl}'`), 'PWA necachuje přesný mobilní optimizer CSS ze seznam.html.');

console.log('Mixed-date shopping plan warning contract OK');
