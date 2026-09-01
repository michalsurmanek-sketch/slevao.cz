import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = readFileSync(new URL('../supabase/migrations/20260901205000_adopt_lidl_verified_pdf_parser.sql', import.meta.url), 'utf8');
const pageCount = readFileSync(new URL('../supabase/migrations/20260901212500_capture_lidl_jina_page_count.sql', import.meta.url), 'utf8');

assert.match(baseline, /create or replace function public\.parse_lidl_verified_markdown/i, 'Lidl verified parser must be source-controlled.');
assert.match(baseline, /create or replace function private\.publish_lidl_verified_markdown_full/i, 'Lidl verified publisher must be source-controlled.');
assert.match(baseline, /lidl-verified-pdf-text-v2/, 'Lidl parser adapter contract is missing.');
assert.match(baseline, /printed_unit_price_math_and_strict_adjacent_validity/, 'Lidl parser must retain printed unit-price verification.');
assert.match(baseline, /abs\(expected_unit_price-printed_unit_price\)<=greatest\(0\.3,printed_unit_price\*0\.02\)/, 'Lidl unit-price tolerance guard changed unexpectedly.');
assert.match(baseline, /Lidl Plus\|různé velikosti/, 'Lidl parser must continue excluding ambiguous Lidl Plus/size layouts.');
assert.match(baseline, /source_confidence',0\.99/, 'Lidl verified provenance confidence is missing.');
assert.match(baseline, /insert into public\.leaflet_import_items\(import_id,product_id,title,quantity_text,price,confidence,status,raw_data\)/i, 'Lidl publisher must source-control leaflet item persistence.');
assert.match(baseline, /source_document_url,source_hash,status,product_count,confidence,coverage_scope,detected_valid_from,detected_valid_to/i, 'Lidl import provenance persistence is missing.');
assert.doesNotMatch(baseline, /source_page\s*[,)]/i, 'Baseline adoption must not invent source_page before a real page boundary is verified.');

assert.match(pageCount, /create or replace function public\.extract_lidl_jina_page_count/i, 'Jina page-count extractor must be source-controlled.');
assert.match(pageCount, /\^Number of Pages:\\s\*\(\[0-9\]\{1,3\}\)\\s\*\$/, 'Page count must come from the explicit Jina PDF header.');
assert.match(pageCount, /page_count between 1 and 200/, 'Jina page count must be range-validated.');
assert.match(pageCount, /set page_count=v_page_count/i, 'Verified import must persist the validated Jina page count.');
assert.match(pageCount, /page_count_source','jina_pdf_markdown_header'/, 'Page-count provenance must be recorded.');
assert.match(pageCount, /page_identity_available',false/, 'Pipeline must explicitly record that per-product page identity is unavailable.');
assert.doesNotMatch(pageCount, /source_page\s*=/i, 'Jina page-count capture must not invent per-product source_page.');
assert.match(pageCount, /public\.publish_lidl_verified_markdown\(/, 'Page count must be recorded after the verified publisher succeeds.');

console.log('Lidl verified parser and Jina page-count provenance: OK');
