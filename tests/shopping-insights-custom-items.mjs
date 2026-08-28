import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-insights.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-insights.js' });

for (const needle of [
  'customResolvedCount: 0',
  'async function calculateRows(targetRows)',
  'const selected = Array.isArray(targetRows) ? targetRows : [];',
  "const customQueries = [...new Set(selected",
  "db.rpc('get_public_shopping_list_candidates'",
  'p_limit_per_query: 30',
  'const customOfferMap = new Map();',
  'function chooseCustomOffer(',
  'offer = chooseCustomOffer(customOfferMap.get(norm(row.custom_name || row.name)) || [], today);',
  'next.customResolvedCount++;',
  'next.linkedCount++;',
  'const unresolvedCustomCount = Math.max(0, metrics.customCount - metrics.customResolvedCount);',
]) {
  assert.ok(source.includes(needle), `Chybí custom-item budget guard: ${needle}`);
}

assert.doesNotMatch(
  source,
  /if \(!row\.product_id\) \{\s*next\.customCount\+\+;\s*next\.snapshots\.push\([\s\S]*?continue;\s*\}/,
  'Rozpočet stále automaticky vyřazuje všechny vlastní položky bez pokusu o resolver.'
);

const chooseStart = source.indexOf('  function chooseCustomOffer(');
const chooseEnd = source.indexOf('\n  async function calculateRows(', chooseStart);
assert.ok(chooseStart >= 0 && chooseEnd > chooseStart, 'chooseCustomOffer nejde izolovaně otestovat.');
const chooseFunction = source.slice(chooseStart, chooseEnd);

const context = { result:null, Array, Number, String };
new Script(`
${chooseFunction}
const offers = [
  { id:'future-cheap', price:8, valid_from:'2026-08-29', valid_to:'2026-09-02' },
  { id:'current', price:10, valid_from:'2026-08-26', valid_to:'2026-09-01' },
  { id:'expired', price:1, valid_from:'2026-08-01', valid_to:'2026-08-20' }
];
globalThis.result = chooseCustomOffer(offers, '2026-08-27');
`, { filename:'shopping-insights-custom-offer-test.js' }).runInNewContext(context);
assert.equal(context.result?.id, 'current', 'Dnešní platná nabídka má mít přednost před levnější budoucí akcí.');

const futureOnlyContext = { result:null, Array, Number, String };
new Script(`
${chooseFunction}
const offers = [
  { id:'future-a', price:12, valid_from:'2026-08-29', valid_to:'2026-09-02' },
  { id:'future-b', price:9, valid_from:'2026-08-30', valid_to:'2026-09-02' }
];
globalThis.result = chooseCustomOffer(offers, '2026-08-27');
`, { filename:'shopping-insights-custom-future-test.js' }).runInNewContext(futureOnlyContext);
assert.equal(futureOnlyContext.result?.id, 'future-b', 'Když není dnešní cena, má se použít nejlevnější platný budoucí kandidát.');

console.log('Shopping insights custom item budget resolver OK');
