import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260901205000_adopt_lidl_verified_pdf_parser.sql', import.meta.url), 'utf8');

assert.match(migration, /create or replace function public\.parse_lidl_verified_markdown/i, 'Lidl verified parser must be source-controlled.');
assert.match(migration, /create or replace function private\.publish_lidl_verified_markdown_full/i, 'Lidl verified publisher must be source-controlled.');
assert.match(migration, /lidl-verified-pdf-text-v2/, 'Lidl parser adapter contract is missing.');
assert.match(migration, /printed_unit_price_math_and_strict_adjacent_validity/, 'Lidl parser must retain printed unit-price verification.');
assert.match(migration, /abs\(expected_unit_price-printed_unit_price\)<=greatest\(0\.3,printed_unit_price\*0\.02\)/, 'Lidl unit-price tolerance guard changed unexpectedly.');
assert.match(migration, /Lidl Plus\|různé velikosti/, 'Lidl parser must continue excluding ambiguous Lidl Plus/size layouts.');
assert.match(migration, /source_confidence',0\.99/, 'Lidl verified provenance confidence is missing.');
assert.match(migration, /insert into public\.leaflet_import_items\(import_id,product_id,title,quantity_text,price,confidence,status,raw_data\)/i, 'Lidl publisher must source-control leaflet item persistence.');
assert.match(migration, /source_document_url,source_hash,status,product_count,confidence,coverage_scope,detected_valid_from,detected_valid_to/i, 'Lidl import provenance persistence is missing.');
assert.doesNotMatch(migration, /source_page\s*[,)]/i, 'Baseline adoption must not invent source_page before a real page boundary is verified.');

console.log('Lidl verified parser source-control baseline: OK');
