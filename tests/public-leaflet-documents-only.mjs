import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260825172500_exclude_globus_product_page_from_leaflets.sql', 'utf8');

assert.match(migration, /create or replace function public\.get_public_current_leaflets\(p_limit integer default 240\)/i,
  'Migration must replace the existing public leaflet RPC without changing its signature.');
assert.match(migration, /security definer/i, 'Public leaflet RPC must preserve SECURITY DEFINER.');
assert.match(migration, /set search_path = public/i, 'Public leaflet RPC must keep a fixed search_path.');
assert.match(migration, /coalesce\(li\.metadata->>'storage_path', ''\) <> ''/,
  'Stored leaflet documents must stay eligible.');
assert.match(migration, /split_part\(coalesce\(li\.source_document_url, ''\), '\?', 1\).*\[\.\]\(pdf\|webp\|png\|jpe\?g\)\$/s,
  'Direct public documents must be recognized independently of URL query parameters.');
assert.match(migration, /s\.slug = 'globus'[\s\S]*store:globus-html[\s\S]*\/letaky\//i,
  'Globus must be limited to its dedicated leaflet source, not the product API action page.');
assert.doesNotMatch(migration, /globus-action-products-api-v1/i,
  'Globus product API imports must never be allowlisted as leaflet documents.');
assert.match(migration, /s\.slug = 'teta'[\s\S]*tetadrogerie\.cz\/akce/i,
  'Teta campaign/listing imports must remain eligible through the explicit Teta resolver boundary.');
assert.match(migration, /partition by c\.store_id, c\.document_identity/i,
  'Equivalent document URLs must be deduplicated by normalized document identity.');
assert.match(migration, /'url:' \|\| lower\(split_part\(li\.source_document_url, '\?', 1\)\)/,
  'Direct document identity must strip cache/signature query parameters before deduplication.');
assert.doesNotMatch(migration, /action-official-html|dm-product-api|jysk-search-api|kosik-official|rossmann-html|clearance-html/i,
  'Product adapters must not be allowlisted into the public leaflet document catalogue.');
assert.match(migration, /revoke all on function public\.get_public_current_leaflets\(integer\) from public/i,
  'RPC must not be executable by the generic PUBLIC role.');
assert.match(migration, /grant execute on function public\.get_public_current_leaflets\(integer\) to anon, authenticated, service_role/i,
  'Public leaflet RPC must preserve its intended caller roles.');

console.log('Public leaflet catalogue is constrained to renderable documents and strict resolver sources.');
