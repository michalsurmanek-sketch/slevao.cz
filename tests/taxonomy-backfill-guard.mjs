import fs from 'node:fs';
import assert from 'node:assert/strict';

const baseSql = fs.readFileSync(new URL('../supabase/migrations/20260816231500_guarded_taxonomy_backfill.sql', import.meta.url), 'utf8');
const hardeningSql = fs.readFileSync(new URL('../supabase/migrations/20260817144800_harden_taxonomy_backfill_runtime.sql', import.meta.url), 'utf8');
const sql = `${baseSql}\n${hardeningSql}`;

assert.match(hardeningSql, /p_limit < 1 or p_limit > 50/i, 'Production backfill batch size must stay capped at 50.');
assert.match(hardeningSql, /default 25/i, 'Production backfill should default to a small batch.');
assert.match(hardeningSql, /lock_timeout = '500ms'/i, 'Backfill must yield quickly on lock contention.');
assert.match(hardeningSql, /statement_timeout = '5s'/i, 'Backfill must fail before becoming a long-running production query.');
assert.match(sql, /p_min_confidence < 0\.96/i, 'Backfill must reject low-confidence thresholds.');
assert.match(sql, /p\.category_id is null/i, 'Backfill must not overwrite existing product category.');
assert.match(sql, /p\.filter_group is null/i, 'Backfill must not overwrite existing filter group.');
assert.match(sql, /classification_confidence is null/i, 'Backfill must not overwrite existing classification confidence.');
assert.match(sql, /product_taxonomy_backfill_log/i, 'Every backfill change must be logged.');
assert.match(sql, /rollback_product_taxonomy_backfill/i, 'A rollback function must exist.');
assert.match(sql, /is not distinct from l\.applied_category_id/i, 'Rollback must only revert rows still matching the applied values.');
assert.match(hardeningSql, /revoke all on function private\.apply_product_taxonomy_candidates.*anon, authenticated/is, 'Backfill function must not be callable by browser roles.');
assert.match(hardeningSql, /grant execute on function private\.apply_product_taxonomy_candidates.*service_role/is, 'Backfill function must be service-role only.');

console.log('taxonomy-backfill-guard: ok');
