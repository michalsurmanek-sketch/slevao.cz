import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list-price-summary.js', root), 'utf8');
const mobileCss = readFileSync(new URL('assets/mobile-optimizer-compact.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');

new Script(source, { filename:'assets/shopping-list-price-summary.js' });

const functionStart = source.indexOf('  function absolutePriceBuckets()');
const functionEnd = source.indexOf('\n  function quantityOf(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Price bucket funkci nejde izolovaně otestovat.');
const bucketFunction = source.slice(functionStart, functionEnd);

const ambiguousStart = source.indexOf('  function ambiguousPriceKeys(');
const ambiguousEnd = source.indexOf('\n  function renderPrices()', ambiguousStart);
assert.ok(ambiguousStart >= 0 && ambiguousEnd > ambiguousStart, 'Duplicate price guard nejde izolovaně otestovat.');
const ambiguousFunction = source.slice(ambiguousStart, ambiguousEnd);

const absoluteBox = {
  classList:{ toggle() {} },
  querySelector(selector) {
    if (selector === 'h3') return { textContent:'Absolutně nejnižší cena' };
    if (selector === '.sfMuted') return { textContent:'Nejnižší cena každé nalezené položky. 1 položek používá akci začínající během příštích 7 dnů.' };
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
      { classList:{ toggle() {} }, querySelector: () => ({ textContent:'Vše v jednom obchodě' }) },
      absoluteBox,
    ];
  },
};

const context = { optimizer, Map, Set, String, Number };
new Script(`
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseMoney = (value) => Number(String(value || '').replace(/\\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  function absoluteBox() {
    const boxes = [...optimizer.querySelectorAll('.sfResultBox')];
    return boxes.find((box) => normalize(box.querySelector('h3')?.textContent) === 'absolutne nejnizsi cena') || boxes[1] || null;
  }
  function boxUsesUpcomingPrice(box) {
    const note = normalize(box?.querySelector('.sfMuted')?.textContent);
    return note.includes('pouziva akci zacinajici');
  }
  ${bucketFunction}
  ${ambiguousFunction}
  const buckets = absolutePriceBuckets();
  globalThis.milk = buckets.get('mleko');
  globalThis.bread = buckets.get('chleb');
  globalThis.upcoming = boxUsesUpcomingPrice(absoluteBox());
  const article = (name) => ({ querySelector(selector) { return selector === '.sfItemName' ? { textContent:name } : null; } });
  globalThis.ambiguousDifferent = ambiguousPriceKeys([article('Mléko'), article('Mléko')], new Map([['mleko', [20, 40]]])).has('mleko');
  globalThis.ambiguousMissing = ambiguousPriceKeys([article('Mléko'), article('Mléko')], new Map([['mleko', [20]]])).has('mleko');
  globalThis.samePriceSafe = ambiguousPriceKeys([article('Mléko'), article('Mléko')], new Map([['mleko', [20, 20]]])).has('mleko');
`, { filename:'shopping-list-price-buckets-test.js' }).runInNewContext(context);

assert.deepEqual(Array.from(context.milk || []), [20, 40], 'Stejnojmenné položky nesmí přepsat předchozí cenu.');
assert.deepEqual(Array.from(context.bread || []), [35], 'Jedinečná položka má mít právě jednu cenu.');
assert.equal(context.upcoming, true, 'Budoucí akce v absolutním plánu není rozpoznaná.');
assert.equal(context.ambiguousDifferent, true, 'Různé ceny u stejného názvu musí být označené jako nejednoznačné.');
assert.equal(context.ambiguousMissing, true, 'Neúplný počet cen u stejného názvu musí být označený jako nejednoznačný.');
assert.equal(context.samePriceSafe, false, 'Stejná cena u všech duplicitních názvů se zbytečně skrývá.');

for (const needle of [
  'function markUpcomingPlans()',
  "box.classList.toggle('hasUpcomingPrice', upcoming);",
  "const timing = absoluteUpcoming ? ' · část cen začne během 7 dnů' : '';",
  "const bucket = prices.get(key) || [];",
  'const subtotal = Number(bucket.shift() || 0);',
  "count >= 2 && count <= 4 ? 'položky' : 'položek'",
  'function syncPriceNode(article, className, html)',
  'if (price.className !== className) price.className = className;',
  'if (price.innerHTML !== html) price.innerHTML = html;',
  'if (summary.innerHTML !== summaryHtml) summary.innerHTML = summaryHtml;',
  'function ambiguousPriceKeys(articles, prices)',
  "syncPriceNode(article, 'sfItemPrice missing', '<strong>Viz<br>souhrn</strong>');",
  "const ambiguity = ambiguousKeys.size ? ' · stejné názvy bez rozpisu' : '';",
]) {
  assert.ok(source.includes(needle), `Chybí cenový timing/render/duplicate kontrakt: ${needle}`);
}

assert.ok(!source.includes("article.querySelector('.sfItemPrice')?.remove();"), 'Price summary nesmí při každém renderu odstranit a znovu vložit cenu; spouštělo by to observer smyčku.');
assert.ok(!source.includes('summary.innerHTML = `<span><b>Celkem</b>'), 'Souhrn nesmí být bezpodmínečně přepisovaný při každém observer průchodu.');

assert.ok(mobileCss.includes('#optimizer .sfResultBox.hasUpcomingPrice::after'), 'Mobilní optimizer neukazuje kompaktní upozornění na budoucí cenu.');
assert.ok(mobileCss.includes('Část cen začne během 7 dnů'), 'Mobilní upozornění na budoucí cenu nemá srozumitelný text.');
assert.ok(html.includes('assets/mobile-optimizer-compact.css?v=20260828-1'), 'seznam.html nenačítá aktuální mobilní timing CSS.');
assert.match(html, /assets\/shopping-list-price-summary\.js\?v=20260828-[0-9]+/, 'seznam.html nenačítá aktuální cenový runtime.');

console.log('Shopping list price summary timing, duplicate safety and idempotent render OK');
