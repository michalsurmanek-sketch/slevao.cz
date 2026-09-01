import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-insights-mobile-order.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-insights-mobile-order.js' });

for (const needle of [
  "window.matchMedia('(max-width: 720px)')",
  "const insights = document.getElementById('shoppingInsights');",
  "if (layout.nextElementSibling !== insights) layout.insertAdjacentElement('afterend', insights);",
  "if (layout.previousElementSibling !== insights) parent.insertBefore(insights, layout);",
  "new MutationObserver(schedule).observe(parent, { childList:true });",
]) assert.ok(source.includes(needle), `Chybí mobile insights-order kontrakt: ${needle}`);

assert.ok(!source.includes('remove()'), 'Insights ordering nesmí sekci mazat.');
assert.ok(!source.includes('hidden = true'), 'Insights ordering nesmí sekci skrývat.');

const orderUrl = html.match(/assets\/shopping-insights-mobile-order\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.match(orderUrl, /^assets\/shopping-insights-mobile-order\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný insights-order runtime.');
assert.ok(html.indexOf(bootstrapUrl) < html.indexOf(orderUrl), 'Insights-order runtime má běžet po bootstrapu, který insights načítá.');
assert.ok(!worker.includes(`'/${orderUrl}'`), 'Insights-order runtime se nesmí vrátit do install-time PWA precache.');
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'Insights-order runtime musí být obsloužený jako kritický statický asset.');
assert.ok(worker.includes("cache: 'reload'"), 'Insights-order runtime musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Insights-order runtime musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('Shopping insights stay before layout on desktop and move after shopping content on mobile');
