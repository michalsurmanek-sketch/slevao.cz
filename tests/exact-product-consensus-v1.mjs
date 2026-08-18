import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818171057_classify_exact_product_consensus_v1.sql', 'utf8');

assert.match(sql, /p\.category_id\s+is\s+null/i, 'Backfill must only target uncategorized products.');
assert.match(sql, /count\(distinct c\.category_id\)\s+as\s+category_count/i, 'Backfill must require category consensus.');
assert.match(sql, /category_count\s*=\s*1/i, 'Ambiguous category matches must be excluded.');
assert.match(sql, /evidence_rows\s*>=\s*3/i, 'Backfill must require at least three matching classified products.');
assert.match(sql, /c\.normalized_name\s*=\s*t\.normalized_name/i, 'Normalized product name must match exactly.');
assert.match(sql, /lower\(btrim\(c\.brand\)\)/i, 'Brand must participate in exact identity.');
assert.match(sql, /lower\(btrim\(c\.quantity_text\)\)/i, 'Quantity must participate in exact identity.');
assert.match(sql, /classification_source\s*=\s*'exact-product-consensus-v1'/i, 'Backfill provenance must be explicit.');
assert.match(sql, /greatest\(coalesce\(p\.classification_confidence,\s*0\),\s*0\.99\)/i, 'Confidence must never be reduced.');
assert.doesNotMatch(sql, /category_id\s*=\s*'[0-9a-f-]{36}'/i, 'Migration must not hardcode generated category UUIDs.');

console.log('exact product consensus v1 regression passed');
