import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-visible-refresh-tick.js', root), 'utf8');
const listSource = readFileSync(new URL('assets/shopping-list.js', root), 'utf8');
const dayPlanSource = readFileSync(new URL('assets/shopping-day-consistent-plan.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-visible-refresh-tick.js' });

for (const needle of [
  'const TICK_MS = 5 * 60 * 1000;',
  'if (document.hidden) return;',
  "window.dispatchEvent(new Event('focus'));",
  'window.setInterval(pulse, TICK_MS)',
  "window.addEventListener('beforeunload'",
  'window.clearInterval(timer)',
]) assert.ok(source.includes(needle), `Chybí visible refresh tick kontrakt: ${needle}`);

assert.ok(listSource.includes('Date.now() - lastOffersLoadedAt >= OFFER_REFRESH_MS'), 'Shopping list nemá vlastní 5min stale guard.');
assert.ok(listSource.includes("window.addEventListener('focus', () =>"), 'Shopping list nereaguje na bezpečný focus refresh pulse.');
assert.ok(dayPlanSource.includes('Date.now() - lastRefreshAt >= REFRESH_MS'), 'Přesný day-plan nemá vlastní stale guard.');
assert.ok(dayPlanSource.includes("window.addEventListener('focus', () =>"), 'Přesný day-plan nereaguje na bezpečný focus refresh pulse.');

let callback = null;
let intervalMs = 0;
let focusPulses = 0;
let cleared = null;
let unload = null;
const context = {
  Event: class Event { constructor(type) { this.type = type; } },
  document:{ hidden:false },
  window:{
    setInterval(fn, ms) { callback = fn; intervalMs = ms; return 77; },
    clearInterval(id) { cleared = id; },
    dispatchEvent(event) { if (event?.type === 'focus') focusPulses += 1; },
    addEventListener(type, fn) { if (type === 'beforeunload') unload = fn; },
  },
};
new Script(source, { filename:'shopping-visible-refresh-tick-runtime.js' }).runInNewContext(context);
assert.equal(intervalMs, 300000, 'Visible shopping refresh nemá pětiminutový interval.');
assert.equal(typeof callback, 'function', 'Refresh interval nebyl zaregistrován.');
callback();
assert.equal(focusPulses, 1, 'Viditelná stránka nevyvolá refresh pulse.');
context.document.hidden = true;
callback();
assert.equal(focusPulses, 1, 'Skrytá stránka nesmí periodicky refreshovat ceny.');
unload();
assert.equal(cleared, 77, 'Interval se při opuštění stránky neuvolní.');

const jsUrl = html.match(/assets\/shopping-visible-refresh-tick\.js\?v=[^"']+/)?.[0] || '';
assert.match(jsUrl, /^assets\/shopping-visible-refresh-tick\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný visible refresh tick.');
assert.ok(worker.includes(`'/${jsUrl}'`), 'PWA nemá stejnou verzi visible refresh ticku jako HTML.');

console.log('Visible shopping page refreshes stale offers and exact plans every five minutes safely');
