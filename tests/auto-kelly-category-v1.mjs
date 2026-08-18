import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const first = readFileSync(new URL('../supabase/migrations/20260818145141_classify_auto_kelly_store_segment_v5.sql', import.meta.url), 'utf8');
const correction = readFileSync(new URL('../supabase/migrations/20260818145306_rename_auto_kelly_classification_source_v1.sql', import.meta.url), 'utf8');

assert.match(first, /s\.slug = 'auto-kelly'/, 'Auto Kelly backfill must be restricted to the retailer.');
assert.match(first, /p\.category_id is null/, 'Auto Kelly backfill must never overwrite existing categories.');
assert.match(first, /where slug = 'auto'/, 'Auto Kelly category must be resolved by slug.');
assert.match(first, /filter_group = 'auto'/, 'Auto Kelly products must use the auto filter group.');
assert.match(first, /classification_reason', 'pure-automotive-retailer'/, 'Auto Kelly classification must be attributable to the retailer segment.');
assert.match(correction, /classification_source = 'auto-kelly-segment-v1'/, 'Auto Kelly provenance must have a unique classifier source.');
assert.match(correction, /metadata->>'classification_reason' = 'pure-automotive-retailer'/, 'Provenance correction must be narrowly scoped.');
assert.doesNotMatch(correction, /classification_source = 'store-segment-v5'/, 'Final Auto Kelly provenance must not use the ambiguous store-segment-v5 label.');

console.log('Auto Kelly category v1 OK');
