import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818195000_deactivate_safe_albert_v4_unbranded_duplicates_v1.sql','utf8');

for (const needle of [
  "pg_advisory_xact_lock(hashtextextended('slevao:albert-publitas-v4', 0))",
  "p.metadata->>'created_from_albert_publitas_text_v4'='true'",
  "coalesce(btrim(p.brand),'')=''",
  'count(distinct a.normalized_alias)=1',
  'count(distinct a.source_store_id)=1',
  "bool_and(coalesce(s.slug,'')='albert')",
  'd.hard_ref=false',
  'd.image_ref=false',
  'v_count <> 38755',
  'v_clusters <> 131',
  "_duplicate_deactivation_policy','albert_v4_unbranded_single_alias_v1'",
  "normalized_name='__inactive_albert_v4_duplicate__:'||p.id::text",
  'insert into public.product_aliases',
  'delete from public.product_aliases'
]) {
  if (!sql.includes(needle)) throw new Error(`Missing Albert unbranded duplicate-cleanup guard: ${needle}`);
}

for (const table of ['offers','import_items','leaflet_import_items','notifications','offer_reports','price_alerts','price_history','product_equivalences','product_favorites','public_product_leaflet_locations','recently_viewed_products','shopping_list_items']) {
  if (!sql.includes(`public.${table}`)) throw new Error(`Missing public hard-reference guard for ${table}`);
}
for (const table of ['offer_visual_fallback_candidates','product_taxonomy_backfill_log','product_taxonomy_candidates']) {
  if (!sql.includes(`private.${table}`)) throw new Error(`Missing private hard-reference guard for ${table}`);
}
for (const table of ['product_image_candidates','product_image_generation_jobs','product_image_library']) {
  if (!sql.includes(`public.${table}`)) throw new Error(`Missing image-reference guard for ${table}`);
}

if (/delete\s+from\s+public\.products/i.test(sql)) throw new Error('Cleanup must deactivate products, never delete them.');
if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(sql)) throw new Error('Cleanup must not hardcode product UUIDs.');

console.log('Albert v4 unbranded duplicate cleanup guards OK');
