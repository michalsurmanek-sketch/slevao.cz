import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const harden = readFileSync(
  new URL('supabase/migrations/20260828182940_harden_penny_no_change_exact_payload_match.sql', root),
  'utf8',
).toLowerCase();
const fix = readFileSync(
  new URL('supabase/migrations/20260828183428_fix_penny_exact_match_metadata.sql', root),
  'utf8',
).toLowerCase();

assert.ok(
  harden.includes('create or replace function private.penny_structured_html_matches_published_set') &&
  fix.includes('create or replace function private.penny_structured_html_matches_published_set'),
  'Penny no-change guard musí zůstat v private exact matcheru.',
);
assert.ok(
  harden.includes('set search_path = public, private, pg_temp') &&
  harden.includes('revoke all on function private.penny_structured_html_matches_published_set') &&
  harden.includes('from public, anon, authenticated, service_role') &&
  harden.includes('to postgres'),
  'Penny exact matcher musí mít fixní search_path a zůstat pouze interní.',
);
for (const needle of [
  "li.status='published'",
  "li.source_hash='penny-structured-html-v1:'||p_signature",
  'li.product_count=p_count',
  'li.detected_valid_from=p_from',
  'li.detected_valid_to=p_to',
  "li.metadata->>'adapter'='penny-structured-html-v1'",
  "li.metadata->>'source_signature'=p_signature",
]) {
  assert.ok(fix.includes(needle), `Penny target import matcher postrádá ${needle}.`);
}
for (const needle of [
  "o.external_id='penny-web:'||p.external_id",
  'o.title=p.title',
  'o.normalized_title=p.normalized_title',
  "o.source_url=p.metadata->>'product_url'",
  'o.valid_from=p.valid_from',
  'o.valid_to=p.valid_to',
  'o.price=p.price',
  'o.old_price is not distinct from p.old_price',
  "o.status='published'",
  'o.is_verified=true',
  'o.confidence_score=0.99',
  "o.coverage_scope='national'",
  'o.region_code is null',
  'o.city_name is null',
  'o.store_location_name is null',
  "coalesce(o.metadata->>'adapter','')='penny-structured-html-v1'",
  "coalesce(o.metadata->>'source_signature','')=p_signature",
]) {
  assert.ok(fix.includes(needle), `Penny exact offer matcher postrádá ${needle}.`);
}
assert.ok(
  fix.includes("o.metadata-'import_id'-'source_signature'-'imported_at'-'source_propagated_from_import_item')=p.metadata"),
  'Offer metadata smí při exact porovnání ignorovat jen známé serverové klíče a parser metadata musí zůstat přesná.',
);
assert.ok(
  !fix.includes("o.metadata-'import_id'-'source_signature'-'imported_at')=p.metadata"),
  'Penny matcher nesmí znovu považovat serverový source_propagated_from_import_item za parser payload.',
);
for (const needle of [
  "lii.raw_data->>'penny_product_slug'=p.external_id",
  "right(lii.title,length(' · '||lii.quantity_text))=' · '||lii.quantity_text",
  "left(lii.title,length(lii.title)-length(' · '||lii.quantity_text))",
  'lii.quantity_text is not distinct from p.quantity_text',
  'lii.price=p.price',
  'lii.old_price is not distinct from p.old_price',
  'lii.confidence=0.99',
  "lii.status='published'",
  "(lii.raw_data-'offer_id'-'external_id')=p.metadata",
]) {
  assert.ok(fix.includes(needle), `Penny exact import-item matcher postrádá ${needle}.`);
}
for (const needle of [
  'exists(select 1 from target_import)',
  'coalesce((select offer_count from campaign),0)=p_count',
  'coalesce((select match_count from exact_offer_matches),0)=p_count',
  'coalesce((select item_count from stored_item_count),0)=p_count',
  'coalesce((select match_count from exact_item_matches),0)=p_count',
]) {
  assert.ok(fix.includes(needle), `Penny no-change rozhodnutí musí být fail-closed: chybí ${needle}.`);
}

console.log('Penny structured full-payload no-change matcher contract OK');
