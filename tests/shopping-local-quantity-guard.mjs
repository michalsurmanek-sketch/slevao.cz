import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-local-quantity-guard.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-local-quantity-guard.js' });

const values = new Map([['slevao-shopping-list-v1', JSON.stringify([
  { id:'valid', quantity:2 },
  { id:'string-valid', quantity:'3.5' },
  { id:'zero', quantity:0 },
  { id:'negative', quantity:-4 },
  { id:'infinite', quantity:'Infinity' },
  { id:'bad', quantity:'abc' },
  { id:'missing' }
])]]);
const storage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, value); }
};
const context = createContext({ window:{}, localStorage:storage, Number, JSON, Math });
new Script(source, { filename:'shopping-local-quantity-guard-runtime.js' }).runInContext(context);
const rows = JSON.parse(values.get('slevao-shopping-list-v1'));
assert.equal(rows.find((r) => r.id === 'valid').quantity, 2);
assert.equal(rows.find((r) => r.id === 'string-valid').quantity, '3.5', 'Platné legacy množství se nemá zbytečně přepisovat.');
assert.equal(rows.find((r) => r.id === 'zero').quantity, 0.01);
assert.equal(rows.find((r) => r.id === 'negative').quantity, 0.01);
assert.equal(rows.find((r) => r.id === 'infinite').quantity, 1);
assert.equal(rows.find((r) => r.id === 'bad').quantity, 1);
assert.equal(Object.hasOwn(rows.find((r) => r.id === 'missing'), 'quantity'), false);
assert.equal(context.window.SlevaoShoppingLocalQuantityGuard.safeQuantity('NaN'), 1);
assert.equal(context.window.SlevaoShoppingLocalQuantityGuard.safeQuantity(-2), 0.01);

const guardUrl = html.match(/assets\/shopping-local-quantity-guard\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.match(guardUrl, /^assets\/shopping-local-quantity-guard\.js\?v=20260828-[0-9]+$/);
assert.ok(html.indexOf(guardUrl) < html.indexOf(bootstrapUrl), 'Quantity guard musí běžet před shopping bootstrapem.');
assert.ok(worker.includes(`'/${guardUrl}'`), 'PWA necachuje quantity guard ze seznam.html.');
console.log('Legacy local shopping quantities are finite and positive before shopping bootstrap');
