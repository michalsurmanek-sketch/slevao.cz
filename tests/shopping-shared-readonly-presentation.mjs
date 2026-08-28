import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-shared-readonly-presentation.js', root), 'utf8');
const css = readFileSync(new URL('assets/shopping-shared-readonly-presentation.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-shared-readonly-presentation.js' });

for (const needle of [
  "const sharedToken = hash.get('share') || query.get('share') || '';",
  "/pouze\\s+ke\\s+čtení/i",
  "document.body.classList.toggle('sfSharedReadonly', readOnly);",
  "attributeFilter:['disabled']",
]) assert.ok(source.includes(needle), `Chybí shared read-only presentation kontrakt: ${needle}`);

for (const needle of [
  'body.sfSharedReadonly .sfAddRow',
  'body.sfSharedReadonly #clearCompleted',
  'body.sfSharedReadonly .sfListItem [data-delete]',
  'body.sfSharedReadonly .sfListLayout > .sfPanel:first-child .sfSectionHead > a.sfButton',
]) assert.ok(css.includes(needle), `Chybí read-only CSS pravidlo: ${needle}`);

assert.ok(!css.includes('#shareList'), 'Read-only prezentace nesmí skrývat sdílení odkazu.');
assert.ok(!css.includes('[data-quantity]{display:none'), 'Read-only prezentace nesmí skrývat množství položky.');
assert.ok(!css.includes('.sfItemName{display:none'), 'Read-only prezentace nesmí skrývat název položky.');

const cssUrl = html.match(/assets\/shopping-shared-readonly-presentation\.css\?v=[^"']+/)?.[0] || '';
const jsUrl = html.match(/assets\/shopping-shared-readonly-presentation\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.match(cssUrl, /^assets\/shopping-shared-readonly-presentation\.css\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzované read-only CSS.');
assert.match(jsUrl, /^assets\/shopping-shared-readonly-presentation\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný read-only runtime.');
assert.ok(html.indexOf(bootstrapUrl) < html.indexOf(jsUrl), 'Read-only presentation runtime má běžet po shopping bootstrapu.');
assert.ok(worker.includes(`'/${cssUrl}'`), 'PWA necachuje read-only presentation CSS.');
assert.ok(worker.includes(`'/${jsUrl}'`), 'PWA necachuje read-only presentation runtime.');

console.log('Shared view-only shopping lists hide edit affordances without changing permissions');
