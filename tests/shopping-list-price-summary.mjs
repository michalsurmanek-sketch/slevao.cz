import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list-price-summary.js', root), 'utf8');

const functionStart = source.indexOf('  function absolutePriceBuckets()');
const functionEnd = source.indexOf('\n  function quantityOf(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Price bucket funkci nejde izolovaně otestovat.');
const bucketFunction = source.slice(functionStart, functionEnd);

const absoluteBox = {
  querySelector(selector) {
    if (selector === 'h3') return { textContent:'Absolutně nejnižší cena' };
    return null;
  },
  querySelectorAll(selector) {
    assert.equal(selector, '.sfStoreTag[title]');
    return [{
      getAttribute(name) {
        assert.equal(name, 'title');
        return 'Mléko – 20 Kč\nMléko – 40 Kč\nChléb – 35 Kč';
      },
    }];
  },
};

const optimizer = {
  querySelectorAll(selector) {
    assert.equal(selector, '.sfResultBox');
    return [
      { querySelector: () => ({ textContent:'Vše v jednom obchodě' }) },
      absoluteBox,
    ];
  },
};

const context = { optimizer, Map, String, Number };
new Script(`
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseMoney = (value) => Number(String(value || '').replace(/\\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  ${bucketFunction}
  const buckets = absolutePriceBuckets();
  globalThis.milk = buckets.get('mleko');
  globalThis.bread = buckets.get('chleb');
`, { filename:'shopping-list-price-buckets-test.js' }).runInNewContext(context);

assert.deepEqual(Array.from(context.milk || []), [20, 40], 'Stejnojmenné položky nesmí přepsat předchozí cenu.');
assert.deepEqual(Array.from(context.bread || []), [35], 'Jedinečná položka má mít právě jednu cenu.');

assert.ok(source.includes("const bucket = prices.get(normalize(name)) || [];"), 'Render musí číst cenový bucket podle názvu.');
assert.ok(source.includes('const subtotal = Number(bucket.shift() || 0);'), 'Každá cena se musí použít maximálně jednou.');
assert.ok(source.includes("count >= 2 && count <= 4 ? 'položky' : 'položek'"), 'Souhrn musí správně skloňovat 5+ položek.');

console.log('Shopping list price summary duplicate handling OK');
