import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260816225500_product_taxonomy_preview.sql', import.meta.url), 'utf8');
const staging = fs.readFileSync(new URL('../supabase/migrations/20260816230500_product_taxonomy_candidate_staging.sql', import.meta.url), 'utf8');

assert.match(sql, /preview_product_taxonomy/i, 'Taxonomy preview function must exist.');
assert.match(sql, /security invoker/i, 'Public taxonomy preview must remain SECURITY INVOKER.');
assert.match(sql, /benu','dr-max','pilulka/, 'Pharmacy exclusion segment must remain explicit.');
assert.doesNotMatch(sql, /\|tablet\|/, 'Generic tablet token must not classify pharmacy tablets as electronics.');
assert.match(sql, /ustni voda/, 'Mouthwash must be handled by drugstore rules before beverage rules.');
assert.match(sql, /rohlik cz/, 'Rohlik.cz brand token must be excluded from bakery matching.');
assert.match(sql, /chips\|prichut\|liker\|rumovy/, 'Processed/flavour exclusions must protect fruit and vegetable classification.');
assert.match(sql, /kombucha/, 'Kombucha must be classified as a beverage before produce rules.');
assert.match(staging, /private\.product_taxonomy_candidates/, 'Classification candidates must stay in private QA staging.');
assert.match(staging, /x\.confidence >= 0\.96/, 'Only high-confidence candidates may enter staging.');
assert.doesNotMatch(staging, /update\s+public\.products/i, 'Staging migration must not mutate public products.');
assert.doesNotMatch(staging, /update\s+public\.offers/i, 'Staging migration must not mutate public offers.');

console.log('product-taxonomy-preview: ok');
