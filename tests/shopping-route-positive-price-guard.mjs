import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-route-positive-price-guard.js', root), 'utf8');
const dayLabelSource = readFileSync(new URL('assets/shopping-route-today-label.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-route-positive-price-guard.js' });
new Script(dayLabelSource, { filename:'assets/shopping-route-today-label.js' });

const calls = [];
const api = {
  async fetchOffersForList(...args) {
    calls.push(['list', ...args]);
    return [
      { id:'valid', price:10 },
      { id:'zero', price:0 },
      { id:'negative', price:-3 },
      { id:'bad', price:'x' },
      { id:'string-valid', price:'4.50' }
    ];
  },
  async fetchOffersForStores(...args) {
    calls.push(['stores', ...args]);
    return [{ id:'ok', price:5 }, { id:'infinite', price:'Infinity' }];
  }
};
const context = createContext({ window:{ SlevaoLocation:api }, Number, Array });
new Script(source, { filename:'shopping-route-positive-price-guard-runtime.js' }).runInContext(context);
assert.equal(api.__slevaoRoutePositivePriceGuard, true, 'GPS price guard se nenainstaloval.');
const list = await api.fetchOffersForList(['rows'], ['stores']);
assert.deepEqual(list.map((row) => row.id), ['valid', 'string-valid']);
const stores = await api.fetchOffersForStores(['stores']);
assert.deepEqual(stores.map((row) => row.id), ['ok']);
assert.equal(calls.length, 2, 'Původní location fetch se nevolá přesně jednou na request.');
const firstListWrapper = api.fetchOffersForList;
new Script(source, { filename:'shopping-route-positive-price-guard-second-install.js' }).runInContext(context);
assert.equal(api.fetchOffersForList, firstListWrapper, 'Druhá instalace znovu obalila GPS fetch.');

for (const needle of [
  "['fetchOffersForList', 'fetchOffersForStores']",
  'Number.isFinite(price) && price > 0',
  'api.__slevaoRoutePositivePriceGuard = true',
]) assert.ok(source.includes(needle), `Chybí GPS positive-price kontrakt: ${needle}`);

for (const needle of [
  "const label = date ? `Dnešní trasa · ${date}` : 'Dnešní trasa';",
  "badge.dataset.routeDate = String(api.TODAY || '');",
  "new MutationObserver(sync).observe(results, { childList:true, subtree:true });",
]) assert.ok(dayLabelSource.includes(needle), `Chybí GPS today-label kontrakt: ${needle}`);

const formatStart = dayLabelSource.indexOf('  function formatDateKey(dateKey)');
const formatEnd = dayLabelSource.indexOf('\n  function sync()', formatStart);
assert.ok(formatStart >= 0 && formatEnd > formatStart, 'GPS date formatter nejde izolovaně otestovat.');
const dateContext = { String, Number, Intl, Date };
new Script(`${dayLabelSource.slice(formatStart, formatEnd)}\nglobalThis.label = formatDateKey('2026-08-28');\nglobalThis.invalid = formatDateKey('bad');`, { filename:'shopping-route-date-format.js' }).runInNewContext(dateContext);
assert.match(dateContext.label, /^28\.\s?8\.$/, 'GPS datum se neformátuje česky jako den a měsíc.');
assert.equal(dateContext.invalid, '', 'Neplatný date key nemá vyrábět datumový badge.');

const guardUrl = html.match(/assets\/shopping-route-positive-price-guard\.js\?v=[^"']+/)?.[0] || '';
const dayLabelUrl = html.match(/assets\/shopping-route-today-label\.js\?v=[^"']+/)?.[0] || '';
const locationUrl = html.match(/assets\/location-service\.js\?v=[^"']+/)?.[0] || '';
const routeUrl = html.match(/assets\/shopping-route\.js\?v=[^"']+/)?.[0] || '';
const autostartUrl = html.match(/assets\/shopping-route-autostart\.js\?v=[^"']+/)?.[0] || '';
assert.match(guardUrl, /^assets\/shopping-route-positive-price-guard\.js\?v=20260828-[0-9]+$/);
assert.match(dayLabelUrl, /^assets\/shopping-route-today-label\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný GPS today label.');
assert.ok(html.indexOf(locationUrl) < html.indexOf(guardUrl), 'GPS price guard musí běžet po location-service.');
assert.ok(html.indexOf(guardUrl) < html.indexOf(routeUrl), 'GPS price guard musí běžet před shopping-route.');
assert.ok(html.indexOf(routeUrl) < html.indexOf(dayLabelUrl), 'GPS today label musí běžet po shopping-route runtime.');
assert.ok(html.indexOf(dayLabelUrl) < html.indexOf(autostartUrl), 'GPS today label má být připravený před route autostartem.');
assert.ok(!worker.includes(`'/${guardUrl}'`), 'GPS positive-price guard se nesmí vrátit do install-time PWA precache.');
assert.ok(!worker.includes(`'/${dayLabelUrl}'`), 'GPS today label se nesmí vrátit do install-time PWA precache.');
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'GPS JavaScript musí být obsloužený jako kritický runtime asset.');
assert.ok(worker.includes("cache: 'reload'"), 'GPS JavaScript musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'GPS JavaScript musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('GPS shopping route filters invalid prices and visibly identifies the exact current shopping day');
