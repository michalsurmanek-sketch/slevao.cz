import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818183149_canonical_offer_source_identity_v1.sql','utf8');

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
  if (!sql.includes(needle)) throw new Error(`Missing canonical source identity guard: ${needle}`);
}

if (!sql.includes("new.valid_from is not null and new.valid_to is not null")) {
  throw new Error('Occurrence identity must require explicit validity');
}
if (!sql.includes("length(clean_ean) between 8 and 14")) {
  throw new Error('EAN identity must validate length');
}
if (/update\s+public\.offers[\s\S]*external_id\s*=\s*'ean:/i.test(sql)) {
  throw new Error('EAN must not be forced into legacy external_id');
}

console.log('canonical offer source identity OK');
