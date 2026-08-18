import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260818144716_classify_consensus_public_groups_v1.sql', import.meta.url), 'utf8');

for (const group of ['fashion','drugstore','garden','pets']) {
  assert.match(sql, new RegExp(`'${group}'`), `Missing approved consensus group ${group}.`);
}
for (const unsafe of ['drinks','pharmacy','electronics','home']) {
  assert.doesNotMatch(sql, new RegExp(`'${unsafe}'::text`), `Known ambiguous group ${unsafe} must not be mapped canonically.`);
}
assert.match(sql, /count\(distinct c\.effective_filter_group\) = 1/, 'Backfill must require single-group consensus per product.');
assert.match(sql, /c\.category_id is null/, 'Candidate offers must still lack canonical category.');
assert.match(sql, /p\.category_id is null/, 'Existing product categories must never be overwritten.');
assert.match(sql, /classification_confidence = 0\.960/, 'Consensus classification must use conservative confidence.');
assert.match(sql, /classification_source = 'public-group-consensus-v1'/, 'Consensus backfill must be versioned.');
assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i, 'Category UUIDs must not be hardcoded.');
assert.match(sql, /refresh materialized view private\.public_offer_search_cache/, 'Public search cache must refresh after the backfill.');

console.log('Consensus category backfill v1 OK');
