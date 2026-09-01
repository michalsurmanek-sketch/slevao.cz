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

const start = source.indexOf('  function label(value)');
const end = source.indexOf('\n  function sync()', start);
assert.ok(start >= 0 && end > start, 'Count label helper nejde izolovaně otestovat.');
const helper = source.slice(start, end);
const context = { Number, Math };
new Script(`${helper}\nglobalThis.values = [0,1,2,3,4,5,11,21].map((n) => [n,label(n)]);`).runInNewContext(context);
assert.deepEqual(Array.from(context.values, ([n, text]) => [n, text]), [
  [0,'položek'],[1,'položka'],[2,'položky'],[3,'položky'],[4,'položky'],[5,'položek'],[11,'položek'],[21,'položek']
]);

assert.match(html, /assets\/shopping-list-copy-guard\.js\?v=20260828-[0-9]+/, 'seznam.html nenačítá count copy guard.');
const url = html.match(/assets\/shopping-list-copy-guard\.js\?v=[^"']+/)?.[0];
assert.ok(url, 'Chybí verzovaný count copy guard.');
assert.ok(!worker.includes(`'/${url}'`), 'Count copy guard se nesmí vrátit do install-time PWA precache.');
assert.ok(worker.includes("cache: 'reload'"), 'Count copy guard musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Count copy guard musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('Shopping list count grammar guard OK');
