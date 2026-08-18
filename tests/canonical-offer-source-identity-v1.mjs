import fs from 'node:fs';

const v1 = fs.readFileSync('supabase/migrations/20260818183149_canonical_offer_source_identity_v1.sql','utf8');
const v2 = fs.readFileSync('supabase/migrations/20260818183540_canonical_offer_source_identity_v2_import_items.sql','utf8');
const v3 = fs.readFileSync('supabase/migrations/20260818184054_canonical_offer_source_identity_v3_source_product.sql','utf8');

for (const needle of [
  'source_item_key text',
  'source_occurrence_key text',
  'create or replace function public.set_offer_source_identity()',
  "store_slug in ('dm','tesco')",
  "'ean:' || clean_ean",
  "'external:' || btrim(new.external_id)",
  'create unique index if not exists offers_published_source_occurrence_uidx',
  "where status='published' and source_occurrence_key is not null",
  "coalesce(region_code,''),",
  "coalesce(city_name,''),",
  "coalesce(store_location_name,'')"
]) {
  if (!v1.includes(needle)) throw new Error(`Missing canonical source identity guard: ${needle}`);
}

for (const needle of [
  'leaflet_import_items_import_product_idx',
  "import_id_text ~* '^[0-9a-f]{8}-",
  'li.import_id=import_id_text::uuid',
  'li.product_id=new.product_id',
  'if import_item_count=1 then',
  "new.source_occurrence_key := 'import-item:' || matched_import_item::text",
  'having count(*)=1'
]) {
  if (!v2.includes(needle)) throw new Error(`Missing import-item occurrence guard: ${needle}`);
}

for (const needle of [
  "canonical_source_url := lower(split_part(split_part(btrim(new.source_url),'?',1),'#',1))",
  "new.source_occurrence_key := 'source-product:' || md5(canonical_source_url)",
  "|| '|product:' || new.product_id::text",
  "|| '|from:' || new.valid_from::text",
  "|| '|to:' || new.valid_to::text",
  'update of store_id,external_id,metadata,valid_from,valid_to,product_id,source_url'
]) {
  if (!v3.includes(needle)) throw new Error(`Missing source-product occurrence guard: ${needle}`);
}

if (!v1.includes("new.valid_from is not null and new.valid_to is not null")) {
  throw new Error('Occurrence identity must require explicit validity');
}
if (!v1.includes("length(clean_ean) between 8 and 14")) {
  throw new Error('EAN identity must validate length');
}
const all = v1 + '\n' + v2 + '\n' + v3;
if (/update\s+public\.offers[\s\S]*external_id\s*=\s*'ean:/i.test(all)) {
  throw new Error('EAN must not be forced into legacy external_id');
}
if (/source_occurrence_key[^\n]*title/i.test(all)) {
  throw new Error('Canonical offer occurrence identity must not fall back to title text');
}

console.log('canonical offer source identity OK');
