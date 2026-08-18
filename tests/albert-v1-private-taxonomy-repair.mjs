import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818194000_repair_albert_v1_private_taxonomy_refs.sql','utf8');

for (const needle of [
  "pg_advisory_xact_lock(hashtextextended('slevao:albert-publitas-v4', 0))",
  "_duplicate_deactivation_policy'='albert_v4_branded_single_alias_v1'",
  'private.product_taxonomy_candidates',
  'private.product_taxonomy_backfill_log',
  'private.offer_visual_fallback_candidates',
  'v_candidates <> 9',
  'v_logs <> 2',
  'v_visual <> 0',
  'v_inactive_canonicals <> 0',
  'partition by m.canonical_id',
  'partition by x.run_id,m.canonical_id',
  'taxonomy-candidate repair found % existing canonical conflicts',
  'taxonomy-log repair found % existing canonical conflicts',
  'delete from private.product_taxonomy_candidates',
  'update private.product_taxonomy_candidates',
  'delete from private.product_taxonomy_backfill_log',
  'update private.product_taxonomy_backfill_log'
]) {
  if (!sql.includes(needle)) throw new Error(`Missing Albert private-ref repair guard: ${needle}`);
}

if (/delete\s+from\s+public\.products/i.test(sql)) throw new Error('Repair must never delete products.');
if (/update\s+public\.products/i.test(sql)) throw new Error('Repair must not reactivate or mutate duplicate products.');
if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(sql)) throw new Error('Repair must not hardcode product UUIDs.');

console.log('Albert v1 private taxonomy repair guards OK');
