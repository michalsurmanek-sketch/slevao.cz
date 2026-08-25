import fs from 'node:fs';
import assert from 'node:assert/strict';

const parser = fs.readFileSync('supabase/functions/sync-terno-ocr-products-v5/index.ts', 'utf8');
const wrapper = fs.readFileSync('supabase/functions/sync-terno-ocr-products-v4/index.ts', 'utf8');

assert.match(parser, /const PARSER = 'terno-ocr-spatial-unit-price-v5'/);
assert.match(parser, /function splitPricePairs\(/);
assert.match(parser, /\^\\d\{1,4\}\$/);
assert.match(parser, /\^\\d\{2\}\$/);
assert.match(parser, /gap < -4 \|\| gap > 40/);
assert.match(parser, /verticalOverlap < 0 && baselineDelta > 14/);
assert.match(parser, /centsHeight < majorHeight\*0\.35 \|\| centsHeight > majorHeight\*1\.25/);
assert.match(parser, /mode:'split_major_cents'/);
assert.match(parser, /delta<=0\.06/);
assert.match(parser, /deterministic_price_check:true/);
assert.match(parser, /terno-ocr-safe-v5-/);

assert.match(wrapper, /sync-terno-ocr-products-v5/);
assert.match(wrapper, /terno-ocr-spatial-unit-price-v5/);
assert.match(wrapper, /targetDate = targetFrom/);
assert.match(wrapper, /candidate_publication_complete:complete/);
assert.match(wrapper, /target_date:targetDate/);
assert.doesNotMatch(wrapper, /LEGACY_URL/);

console.log('Terno split-price parser v5 regression OK');
