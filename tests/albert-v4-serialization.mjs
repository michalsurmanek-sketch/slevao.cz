import fs from 'node:fs';

const serializeSql = fs.readFileSync('supabase/migrations/20260818190657_serialize_albert_v4_publisher.sql','utf8');
const productKeySql = fs.readFileSync('supabase/migrations/20260818191215_fix_albert_v4_product_name_key.sql','utf8');

for (const needle of [
  "pg_get_functiondef('public.publish_albert_publitas_text_offers_v4(text,jsonb)'::regprocedure)",
  "pg_advisory_xact_lock(hashtextextended(''slevao:albert-publitas-v4'', 0))",
  "if v_def like '%slevao:albert-publitas-v4%'",
  "raise exception 'Albert v4 publisher body changed; advisory lock insertion point was not found.'"
]) {
  if (!serializeSql.includes(needle)) throw new Error(`Missing Albert v4 serialization guard: ${needle}`);
}

for (const needle of [
  'v_product_norm text;',
  'v_product_norm := public.normalize_product_name(v_title);',
  "v_new := replace(v_new, E'=v_norm\\n        and (v_qty is null', E'=v_product_norm\\n        and (v_qty is null');",
  "v_new := replace(v_new, E'=v_norm\\n        and ((v_qty is null', E'=v_product_norm\\n        and ((v_qty is null');",
  "v_new := replace(v_new, 'values(v_title,v_norm,v_brand,v_qty,v_image,', 'values(v_title,v_product_norm,v_brand,v_qty,v_image,');",
  "v_new like '%coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_norm%'",
  "raise exception 'Albert v4 product-key patch did not apply cleanly.'"
]) {
  if (!productKeySql.includes(needle)) throw new Error(`Missing Albert product-key guard: ${needle}`);
}

if (/pg_try_advisory_xact_lock/i.test(serializeSql)) {
  throw new Error('Albert v4 publisher must serialize, not silently skip, concurrent publishes.');
}

console.log('Albert v4 serialization and product-key guards OK');
