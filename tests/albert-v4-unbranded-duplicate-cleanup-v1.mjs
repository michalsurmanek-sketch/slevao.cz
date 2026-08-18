import fs from 'node:fs';

const batches = [
  ['20260818200839_deactivate_safe_albert_v4_unbranded_duplicates_b.sql', 4443, 9, "('b')"],
  ['20260818201017_deactivate_safe_albert_v4_unbranded_duplicates_z.sql', 3919, 10, "('z')"],
  ['20260818201050_deactivate_safe_albert_v4_unbranded_duplicates_s.sql', 4340, 11, "('s')"],
  ['20260818201119_deactivate_safe_albert_v4_unbranded_duplicates_p.sql', 3653, 17, "('p')"],
  ['20260818201158_deactivate_safe_albert_v4_unbranded_duplicates_r.sql', 2738, 9, "('r')"],
  ['20260818201223_deactivate_safe_albert_v4_unbranded_duplicates_tuvw.sql', 4252, 17, "('t','u','v','w')"],
  ['20260818201246_deactivate_safe_albert_v4_unbranded_duplicates_jl.sql', 4314, 11, "('j','l')"],
  ['20260818201331_deactivate_safe_albert_v4_unbranded_duplicates_mo.sql', 4685, 17, "('m','o')"],
  ['20260818201357_deactivate_safe_albert_v4_unbranded_duplicates_acdf.sql', 3222, 17, "('a','c','d','f')"],
  ['20260818201421_deactivate_safe_albert_v4_unbranded_duplicates_ghk.sql', 3189, 13, "('g','h','k')"],
];

const publicHardRefs = ['offers','import_items','leaflet_import_items','notifications','offer_reports','price_alerts','price_history','product_equivalences','product_favorites','public_product_leaflet_locations','recently_viewed_products','shopping_list_items'];
const privateHardRefs = ['offer_visual_fallback_candidates','product_taxonomy_backfill_log','product_taxonomy_candidates'];
const imageRefs = ['product_image_candidates','product_image_generation_jobs','product_image_library'];

let totalRows = 0;
let totalClusters = 0;

for (const [file, rows, clusters, initials] of batches) {
  const path = `supabase/migrations/${file}`;
  if (!fs.existsSync(path)) throw new Error(`Missing production Albert cleanup migration: ${file}`);
  const sql = fs.readFileSync(path, 'utf8');
  totalRows += rows;
  totalClusters += clusters;

  for (const needle of [
    "pg_advisory_xact_lock(hashtextextended('slevao:albert-publitas-v4', 0))",
    "p.metadata->>'created_from_albert_publitas_text_v4'='true'",
    "coalesce(btrim(p.brand),'')=''",
    `left(p.normalized_name,1) in ${initials}`,
    'count(distinct a.normalized_alias)=1',
    'count(distinct a.source_store_id)=1',
    "bool_and(coalesce(s.slug,'')='albert')",
    'd.hard_ref=false',
    'd.image_ref=false',
    `v_count<>${rows}`,
    `v_clusters<>${clusters}`,
    "_duplicate_deactivation_policy','albert_v4_unbranded_single_alias_v1'",
    "normalized_name='__inactive_albert_v4_duplicate__:'||p.id::text",
    'insert into public.product_aliases',
    'delete from public.product_aliases'
  ]) {
    if (!sql.includes(needle)) throw new Error(`${file}: missing guard ${needle}`);
  }

  for (const table of publicHardRefs) {
    if (!sql.includes(`public.${table}`)) throw new Error(`${file}: missing public hard-reference guard for ${table}`);
  }
  for (const table of privateHardRefs) {
    if (!sql.includes(`private.${table}`)) throw new Error(`${file}: missing private hard-reference guard for ${table}`);
  }
  for (const table of imageRefs) {
    if (!sql.includes(`public.${table}`)) throw new Error(`${file}: missing image-reference guard for ${table}`);
  }

  if (/delete\s+from\s+public\.products/i.test(sql)) throw new Error(`${file}: cleanup must deactivate products, never delete them.`);
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(sql)) throw new Error(`${file}: cleanup must not hardcode product UUIDs.`);
}

if (totalRows !== 38755) throw new Error(`Albert cleanup batch row total drifted: ${totalRows} != 38755`);
if (totalClusters !== 131) throw new Error(`Albert cleanup batch cluster total drifted: ${totalClusters} != 131`);
if (fs.existsSync('supabase/migrations/20260818195000_deactivate_safe_albert_v4_unbranded_duplicates_v1.sql')) {
  throw new Error('Obsolete monolithic Albert cleanup migration must stay removed.');
}

console.log('Albert v4 unbranded duplicate cleanup batches OK: 38755 rows / 131 clusters');
