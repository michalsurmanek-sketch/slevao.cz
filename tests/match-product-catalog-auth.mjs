import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const fn = read('supabase/functions/match-product-catalog/index.ts');
const config = read('supabase/functions/match-product-catalog/config.toml');
const queueMigration = read('supabase/migrations/20260805002500_product_catalog_match_queue.sql');
const lockMigration = read('supabase/migrations/20260808105000_lock_internal_authenticated_job_rpc.sql');

assert.match(config, /^verify_jwt\s*=\s*false\s*$/m, 'Catalog matcher musí zůstat v custom-auth režimu pro DB cron launcher.');
assert.match(fn, /x-cron-secret/, 'Catalog matcher neověřuje cron secret.');
assert.match(fn, /SERVICE_ROLE_KEY/, 'Catalog matcher neověřuje service-role volání.');
assert.match(fn, /\['admin', 'editor'\]/, 'Catalog matcher neomezuje user JWT na admin/editor.');
assert.match(queueMigration, /create or replace function public\.queue_product_catalog_matching/i, 'Queue launcher není source-controlled.');
assert.match(queueMigration, /functions\/v1\/match-product-catalog/, 'Queue launcher nevolá catalog matcher.');
assert.match(queueMigration, /x-cron-secret/, 'Queue launcher neposílá cron secret.');
assert.match(lockMigration, /revoke execute on function public\.queue_product_catalog_matching\(integer\) from public, anon, authenticated;/, 'Queue launcher není odebraný klientským rolím.');
assert.match(lockMigration, /grant execute on function public\.queue_product_catalog_matching\(integer\) to service_role;/, 'Queue launcher nemá explicitní service_role grant.');

assert.match(fn, /const AUTO_MATCH_THRESHOLD = 0\.92;/, 'Bezpečný katalogový threshold se nesmí snížit pod 0.92.');
assert.match(
  fn,
  /product\?\.image_url && product\.image_verified && Number\(product\.image_quality \|\| 0\) >= 70/,
  'Automaticky přebíraný obrázek musí zůstat verified a s kvalitou alespoň 70.',
);
assert.match(fn, /recheck_missing_images/, 'Catalog matcher musí podporovat explicitní recheck chybějících obrázků.');
assert.match(fn, /store_slug/, 'Image recheck musí být omezen konkrétním obchodem.');
assert.match(fn, /recheck_missing_images vyžaduje store_slug/, 'Image recheck bez store_slug musí být odmítnut.');
assert.match(fn, /\.eq\('store_id', options\.storeId\)/, 'Image recheck musí filtrovat jediný obchod.');
assert.match(fn, /\.is\('image_url', null\)/, 'Image recheck smí vybírat jen nabídky bez obrázku.');
assert.match(fn, /\.lte\('valid_from', today\)/, 'Image recheck musí ignorovat budoucí nabídky.');
assert.match(fn, /\.gte\('valid_to', today\)/, 'Image recheck musí ignorovat prošlé nabídky.');
assert.match(
  fn,
  /\.order\('catalog_checked_at', \{ ascending: true, nullsFirst: true \}\)[\s\S]*?\.order\('published_at', \{ ascending: false, nullsFirst: false \}\)/,
  'Image recheck musí rotovat od nejdéle nekontrolovaných nabídek, ne opakovat stále stejný batch.',
);
assert.match(
  fn,
  /options\.recheckMissingImages && !isApprovedImage\(product\)/,
  'V image recheck režimu nesmí být kandidátem produkt bez schváleného obrázku.',
);
assert.match(fn, /offer_id nelze kombinovat s recheck_missing_images/, 'Jednorázový offer_id režim se nesmí míchat s hromadným recheckem.');

assert.match(fn, /function describeError\(error: unknown\)/, 'Catalog matcher musí umět serializovat plain-object Supabase/PostgREST chyby.');
assert.match(fn, /record\.code/, 'Diagnostika musí zachovat Supabase error code.');
assert.match(fn, /record\.details/, 'Diagnostika musí zachovat Supabase error details.');
assert.match(fn, /record\.hint/, 'Diagnostika musí zachovat Supabase error hint.');
assert.match(fn, /JSON\.stringify\(error\)/, 'Plain-object chyba musí mít bezpečný JSON fallback.');
assert.doesNotMatch(fn, /error instanceof Error \? error\.message : String\(error\)/, 'Catalog matcher nesmí znovu degradovat plain-object chybu na [object Object].');
assert.match(fn, /error_code: diagnostic\.code/, 'Per-offer diagnostika musí vracet strukturovaný error code.');
assert.match(fn, /code: diagnostic\.code,[\s\S]*details: diagnostic\.details,[\s\S]*hint: diagnostic\.hint/, 'Top-level HTTP 500 musí zachovat code/details/hint.');

console.log('Catalog matcher custom auth + safe rotating image recheck + structured diagnostics OK');
