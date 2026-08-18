import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818091500_index_visual_fallback_foreign_keys.sql', root), 'utf8');

for (const column of ['import_id', 'product_id', 'store_id']) {
  assert.match(sql, new RegExp(`offer_visual_fallback_candidates_${column}_idx[\\s\\S]*offer_visual_fallback_candidates\\(${column}\\)`, 'i'));
}

console.log('Visual fallback foreign-key indexes OK');
