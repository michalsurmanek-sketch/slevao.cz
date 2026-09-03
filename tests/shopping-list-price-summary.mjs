import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list-price-summary.js', root), 'utf8');
const mobileCss = readFileSync(new URL('assets/mobile-optimizer-compact.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');

new Script(source, { filename:'assets/shopping-list-price-summary.js' });

const absoluteStart = source.indexOf('  function absoluteBox()');
const absoluteEnd = source.indexOf('\n  function boxUsesUpcomingPrice', absoluteStart);
assert.ok(absoluteStart >= 0 && absoluteEnd > absoluteStart, 'Absolute box selector nejde izolovaně otestovat.');
const absoluteFunction = source.slice(absoluteStart, absoluteEnd);

const functionStart = source.indexOf('  function absolutePriceBuckets()');
const functionEnd = source.indexOf('\n  function localUnitMap()', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Price bucket funkci nejde izolovaně otestovat.');
const bucketFunction = source.slice(functionStart, functionEnd);

const localUnitsStart = source.indexOf('  function localUnitMap()');
const quantityStart = source.indexOf('\n  function quantityOf(', localUnitsStart);
assert.ok(localUnitsStart >= 0 && quantityStart > localUnitsStart, 'Local unit map nejde izolovaně otestovat.');
const localUnitsFunction = source.slice(localUnitsStart, quantityStart);

const unitStart = source.indexOf('  function unitLabel(');
const unitEnd = source.indexOf('\n  function syncPriceNode(', unitStart);
assert.ok(unitStart >= 0 && unitEnd > unitStart, 'Unit label funkci nejde izolovaně otestovat.');
const unitFunction = source.slice(unitStart, unitEnd);

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
    return [{ getAttribute() { return 'Mléko – 20 Kč\nMléko – 40 Kč\nChléb – 35 Kč'; } }];
  },
};
const optimizer = {
  querySelector(selector) {
    if (selector === '[data-day-consistent-plan="true"]') return null;
    return null;
  },
  querySelectorAll() {
    return [
      { classList:{ toggle() {} }, querySelector: () => ({ textContent:'Vše v jednom obchodě' }) },
      absoluteBox,
    ];
  },
};

const preciseBox = { marker:'precise' };
const preferenceContext = {
  optimizer:{
    querySelector(selector) { return selector === '[data-day-consistent-plan="true"]' ? preciseBox : null; },
    querySelectorAll() { return [absoluteBox]; },
  },
  String,
};
new Script(`
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  ${absoluteFunction}
  globalThis.selected = absoluteBox();
`, { filename:'price-summary-day-plan-preference.js' }).runInNewContext(preferenceContext);
assert.equal(preferenceContext.selected, preciseBox, 'Price summary nepreferuje přesný jednodenní plán před smíšeným 7denním plánem.');

const context = { optimizer, Map, Set, String, Number };
new Script(`
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseMoney = (value) => Number(String(value || '').replace(/\\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
  const safeUnit = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    return /^[a-z0-9á-ž.%/-]{1,12}$/i.test(raw) ? raw : '';
  };
  ${absoluteFunction}
  function boxUsesUpcomingPrice(box) {
    const note = normalize(box?.querySelector('.sfMuted')?.textContent);
    return note.includes('pouziva akci zacinajici');
  }
  ${bucketFunction}
  ${unitFunction}
  ${ambiguousFunction}
  const buckets = absolutePriceBuckets();
  globalThis.milk = buckets.get('mleko');
  globalThis.bread = buckets.get('chleb');
  globalThis.upcoming = boxUsesUpcomingPrice(absoluteBox());
  const article = (name) => ({ querySelector(selector) { return selector === '.sfItemName' ? { textContent:name } : null; } });
  globalThis.ambiguousDifferent = ambiguousPriceKeys([article('Mléko'), article('Mléko')], new Map([['mleko', [20, 40]]])).has('mleko');
  globalThis.ambiguousMissing = ambiguousPriceKeys([article('Mléko'), article('Mléko')], new Map([['mleko', [20]]])).has('mleko');
  globalThis.samePriceSafe = ambiguousPriceKeys([article('Mléko'), article('Mléko')], new Map([['mleko', [20, 20]]])).has('mleko');
  const unitArticle = (id, inputUnit, articleUnit) => ({
    dataset:{ id, unit:articleUnit || '' },
    querySelector(selector) { return selector === '[data-quantity]' ? { dataset:{ unit:inputUnit || '' } } : null; }
  });
  const units = new Map([['row-kg','kg'], ['row-l','l']]);
  globalThis.unitDirect = unitLabel(unitArticle('row-kg', 'bal', ''), units);
  globalThis.unitKg = unitLabel(unitArticle('row-kg', '', ''), units);
  globalThis.unitLitres = unitLabel(unitArticle('row-l', '', ''), units);
  globalThis.unitUnknown = unitLabel(unitArticle('missing', '', ''), units);
  globalThis.unitUnsafe = unitLabel(unitArticle('missing', '<script>', ''), units);
`, { filename:'shopping-list-price-buckets-test.js' }).runInNewContext(context);

assert.deepEqual(Array.from(context.milk || []), [20, 40], 'Stejnojmenné položky nesmí přepsat předchozí cenu.');
assert.deepEqual(Array.from(context.bread || []), [35], 'Jedinečná položka má mít právě jednu cenu.');
assert.equal(context.upcoming, true, 'Budoucí akce v absolutním plánu není rozpoznaná.');
assert.equal(context.ambiguousDifferent, true, 'Různé ceny u stejného názvu musí být označené jako nejednoznačné.');
assert.equal(context.ambiguousMissing, true, 'Neúplný počet cen u stejného názvu musí být označené jako nejednoznačné.');
assert.equal(context.samePriceSafe, false, 'Stejná cena u všech duplicitních názvů se zbytečně skrývá.');
assert.equal(context.unitDirect, 'bal', 'Přímá DOM jednotka musí mít přednost před localStorage fallbackem.');
assert.equal(context.unitKg, 'kg', 'Jednotka kg z lokálního řádku se nedohledala podle data-id.');
assert.equal(context.unitLitres, 'l', 'Jednotka l z lokálního řádku se nedohledala podle data-id.');
assert.equal(context.unitUnknown, '', 'Neznámá jednotka má skrýt jednotkovou cenu.');
assert.equal(context.unitUnsafe, '', 'Nebezpečný unit label se nesmí vložit do HTML.');

for (const needle of [
  "const precise = optimizer.querySelector('[data-day-consistent-plan=\"true\"]');",
  'if (precise) return precise;',
  "const LIST_KEY = 'slevao-shopping-list-v1';",
  'const sharedMode = Boolean(sharedQuery.get(\'share\') || sharedHash.get(\'share\'));',
  'const safeUnit = (value) =>',
  'function localUnitMap()',
  'if (sharedMode) return map;',
  "JSON.parse(localStorage.getItem(LIST_KEY) || '[]')",
  'if (localId) map.set(localId, unit);',
  'if (serverId) map.set(serverId, unit);',
  'function unitLabel(article, units)',
  "return safeUnit(units?.get(String(article?.dataset?.id || '').trim()) || '');",
  'const units = localUnitMap();',
  'const label = unitLabel(article, units);',
  'qty > 1 && label ? `<small>${money(unit)} / ${label}</small>` :',
  'function futureDayLabel(box)',
  "box?.querySelector('.sfDayPlanDate[data-plan-date]')",
  "const timing = futureTiming ? ` · ${futureTiming}` : (absoluteUpcoming ? ' · ceny nemusí platit ve stejný den' : '');",
  "attributeFilter: ['value', 'data-unit']",
  'function ambiguousPriceKeys(articles, prices)',
]) {
  assert.ok(source.includes(needle), `Chybí cenový unit/storage/render kontrakt: ${needle}`);
}
assert.ok(source.includes("const summaryLabel = complete ? 'Celkem' : 'Mezisoučet';"), 'Neúplné cenové pokrytí musí být označené jako Mezisoučet, ne Celkem.');
assert.ok(source.includes('<span><b>${summaryLabel}</b><small>${coverage}${timing}${ambiguity}</small></span>'), 'Souhrn musí vykreslit dynamický štítek Celkem/Mezisoučet.');
assert.ok(!source.includes('${money(unit)} / ks'), 'Jednotková cena se nesmí natvrdo vydávat za ks.');
assert.ok(!source.includes('/ jednotku'), 'Neznámá jednotka se nesmí zobrazovat jako generický popisek.');
assert.ok(!source.includes('část cen začne během 7 dnů'), 'Celkový součet nesmí zamlčet, že budoucí akce nemusí platit současně.');

const localUnitContext = {
  Map,
  Array,
  String,
  JSON,
  sharedMode:false,
  LIST_KEY:'slevao-shopping-list-v1',
  safeUnit:(value) => /^[a-z0-9á-ž.%/-]{1,12}$/i.test(String(value || '').trim().toLowerCase()) ? String(value).trim().toLowerCase() : '',
  localStorage:{ getItem() { return JSON.stringify([
    { local_id:'local-1', server_id:'server-1', unit:'kg' },
    { local_id:'unsafe', unit:'<script>' },
  ]); } },
};
new Script(`${localUnitsFunction}\nglobalThis.units = localUnitMap();`, { filename:'shopping-local-units-test.js' }).runInNewContext(localUnitContext);
assert.equal(localUnitContext.units.get('local-1'), 'kg', 'Local ID unit mapping chybí.');
assert.equal(localUnitContext.units.get('server-1'), 'kg', 'Server ID unit mapping chybí.');
assert.equal(localUnitContext.units.has('unsafe'), false, 'Nebezpečná jednotka se dostala do mapy.');

const sharedUnitContext = { ...localUnitContext, sharedMode:true, localStorage:{ getItem() { throw new Error('Shared režim nesmí číst localStorage jednotky.'); } } };
new Script(`${localUnitsFunction}\nglobalThis.units = localUnitMap();`, { filename:'shopping-shared-units-test.js' }).runInNewContext(sharedUnitContext);
assert.equal(sharedUnitContext.units.size, 0, 'Shared seznam nesmí přebírat jednotky z lokálního vlastního seznamu.');

assert.ok(mobileCss.includes('#optimizer .sfResultBox.hasUpcomingPrice::after'), 'Mobilní optimizer neukazuje kompaktní upozornění na budoucí cenu.');
assert.ok(mobileCss.includes('Akce nemusí platit ve stejný den'), 'Mobilní upozornění neříká, že 7denní ceny nemusí být současně dosažitelné.');
assert.ok(mobileCss.includes('max-width:100%'), 'Mobilní mixed-date badge nemá ochranu proti přetečení.');
assert.match(html, /assets\/mobile-optimizer-compact\.css\?v=20260828-[0-9]+/, 'seznam.html nenačítá aktuální mobilní optimizer CSS.');
assert.match(html, /assets\/shopping-list-price-summary\.js\?v=20260828-[0-9]+/, 'seznam.html nenačítá aktuální cenový runtime.');

console.log('Shopping list price summary prefers day-consistent plan, labels partial totals, and keeps unit/shared safety OK');
