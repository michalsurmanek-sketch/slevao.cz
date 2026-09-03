import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list-copy-guard.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-list-copy-guard.js' });

for (const needle of [
  "if (number === 1) return 'položka';",
  "if (number >= 2 && number <= 4) return 'položky';",
  "return 'položek';",
  "String(count.textContent || '').match(/^\\s*(\\d+)/)",
  'if (count.textContent !== desired) count.textContent = desired;',
  "new MutationObserver(sync).observe(count, { childList:true, characterData:true, subtree:true });",
]) {
  assert.ok(source.includes(needle), `Chybí count grammar kontrakt: ${needle}`);
}

for (const needle of [
  "const optimizer = document.getElementById('optimizer');",
  'function unresolvedCount()',
  "text.match(/(\\d+)\\s+(?:položku|položky|položek)\\s+se nepodařilo spolehlivě najít/i)",
  "let note = box.querySelector('.sfPartialCoverage');",
  "note.className = 'sfMuted sfPartialCoverage';",
  "const desired = `Mezisoučet · ${missing} ${missingLabel(missing)}`;",
  "box.classList.add('hasPartialCoverage');",
  "box.classList.remove('hasPartialCoverage');",
  "if (optimizer) new MutationObserver(sync).observe(optimizer, { childList:true, characterData:true, subtree:true });",
]) {
  assert.ok(source.includes(needle), `Chybí partial optimizer copy kontrakt: ${needle}`);
}

const labelStart = source.indexOf('  function label(value)');
const labelEnd = source.indexOf('\n  function missingLabel(value)', labelStart);
assert.ok(labelStart >= 0 && labelEnd > labelStart, 'Count label helper nejde izolovaně otestovat.');
const labelHelper = source.slice(labelStart, labelEnd);

const missingStart = source.indexOf('  function missingLabel(value)');
const missingEnd = source.indexOf('\n  function syncCount()', missingStart);
assert.ok(missingStart >= 0 && missingEnd > missingStart, 'Missing-item label helper nejde izolovaně otestovat.');
const missingHelper = source.slice(missingStart, missingEnd);

const context = { Number, Math };
new Script(`${labelHelper}\n${missingHelper}\nglobalThis.values = [0,1,2,3,4,5,11,21].map((n) => [n,label(n),missingLabel(n)]);`).runInNewContext(context);
assert.deepEqual(Array.from(context.values, ([n, text, missing]) => [n, text, missing]), [
  [0,'položek','položek bez ceny'],
  [1,'položka','položka bez ceny'],
  [2,'položky','položky bez ceny'],
  [3,'položky','položky bez ceny'],
  [4,'položky','položky bez ceny'],
  [5,'položek','položek bez ceny'],
  [11,'položek','položek bez ceny'],
  [21,'položek','položek bez ceny'],
]);

assert.match(html, /assets\/shopping-list-copy-guard\.js\?v=20260828-[0-9]+/, 'seznam.html nenačítá count copy guard.');
const url = html.match(/assets\/shopping-list-copy-guard\.js\?v=[^"']+/)?.[0];
assert.ok(url, 'Chybí verzovaný count copy guard.');
assert.ok(!worker.includes(`'/${url}'`), 'Count copy guard se nesmí vrátit do install-time PWA precache.');
assert.ok(worker.includes("cache: 'reload'"), 'Count copy guard musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Count copy guard musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('Shopping list count grammar and partial optimizer subtotal guard OK');
