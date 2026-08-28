import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-route-positive-price-guard.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-route-positive-price-guard.js' });

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

const guardUrl = html.match(/assets\/shopping-route-positive-price-guard\.js\?v=[^"']+/)?.[0] || '';
const locationUrl = html.match(/assets\/location-service\.js\?v=[^"']+/)?.[0] || '';
const routeUrl = html.match(/assets\/shopping-route\.js\?v=[^"']+/)?.[0] || '';
assert.match(guardUrl, /^assets\/shopping-route-positive-price-guard\.js\?v=20260828-[0-9]+$/);
assert.ok(html.indexOf(locationUrl) < html.indexOf(guardUrl), 'GPS price guard musí běžet po location-service.');
assert.ok(html.indexOf(guardUrl) < html.indexOf(routeUrl), 'GPS price guard musí běžet před shopping-route.');
assert.ok(worker.includes(`'/${guardUrl}'`), 'PWA necachuje GPS positive-price guard.');

console.log('GPS shopping route filters zero, negative and non-finite offer prices before planning');
