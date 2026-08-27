import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-insights.js', root), 'utf8');

for (const needle of [
  'const unpricedCount = Math.max(0, metrics.itemCount - metrics.linkedCount);',
  'Z nalezených cen zbývá do rozpočtu přibližně',
  'Rozpočet je překročen nejméně o',
  'Odhad ${money(metrics.total)} Kč zahrnuje cenu u ${metrics.linkedCount} z ${metrics.itemCount} položek',
  'const pricedCount = purchaseItems.filter((item) => item?.subtotal != null).length;',
  "const completeness = itemCount > 0 && pricedCount < itemCount ? ` · oceněno ${pricedCount}/${itemCount}` : '';",
]) {
  assert.ok(source.includes(needle), `Chybí ochrana částečného odhadu: ${needle}`);
}

assert.doesNotMatch(
  source,
  /const remaining = budget - metrics\.total;[\s\S]{0,500}note\.textContent = remaining >= 0\s*\? `Do rozpočtu zbývá/,
  'Rozpočet stále prezentuje částečný odhad jako jistý zůstatek.'
);

assert.ok(
  source.includes("const itemCountText = (value) =>"),
  'Insights nemají jednotné skloňování počtu položek.'
);

console.log('Shopping insights partial estimate disclosure OK');
