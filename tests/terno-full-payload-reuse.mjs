import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/sync-terno-ocr-products-v5/index.ts','utf8');

assert.match(source, /const PAYLOAD_CONTRACT = 'terno-ocr-safe-v6'/,
  'TERNO musí mít samostatně verzovaný v6 full-payload kontrakt.');
assert.match(source, /crypto\.subtle\.digest\('SHA-256'/,
  'TERNO reuse fingerprint musí používat SHA-256.');
for (const needle of [
  'payload_contract:PAYLOAD_CONTRACT',
  'parser_contract:PARSER',
  'source_import_id:String(sourceImport.id)',
  "source_document_url:String(sourceImport.source_document_url||'')",
  "valid_from:String(sourceImport.detected_valid_from||'')",
  "valid_to:String(sourceImport.detected_valid_to||'')",
  'coverage_scope:String(sourceImport.coverage_scope||\'city\')',
  "region_code:String(sourceImport.region_code||'')",
  "city_name:String(sourceImport.city_name||'')",
  "store_location_name:String(sourceImport.store_location_name||'')",
  'rows:stableSort(candidates.map(parserRow))',
]) {
  assert.ok(source.includes(needle), `TERNO full-payload hash postrádá ${needle}.`);
}
assert.match(source, /const hash=`terno-ocr-safe-v6-\$\{fullPayloadSha256\}`/,
  'Nové TERNO importy musí být identifikované full-payload SHA-256 hashem.');
assert.doesNotMatch(source,
  /const hash=`terno-ocr-safe-v5-\$\{sourceImport\.id\}`;[\s\S]{0,300}status==='published'\) return json/,
  'Starý source-id-only TERNO reuse se nesmí vrátit.');
assert.match(source, /async function storedImportMatches\(/,
  'Published TERNO reuse musí ověřit uložené import-items.');
assert.match(source, /\.select\('title,price,quantity_text,source_page,confidence,raw_data,status'\)/,
  'TERNO exact reuse musí číst celý deterministický OCR parser kontrakt.');
assert.match(source, /some\(\(item:any\)=>item\.status!=='published'\)\) return false/,
  'TERNO reuse nesmí přijmout částečně publikovaný import.');
assert.match(source, /return sameStoredPayload\(q\.data\|\|\[\],candidates\)/,
  'TERNO musí porovnávat celý uložený payload, ne jen počet položek.');
assert.match(source, /function storedBaseTitle\(item:any\)[\s\S]*suffix=quantity\?` · \$\{quantity\}`:''[\s\S]*title\.endsWith\(suffix\)/,
  'Legacy matcher smí odstranit jen přesný display suffix množství.');
for (const field of [
  'parser:clean(raw?.parser)',
  'unit_price:Number(raw?.unit_price)',
  'unit_price_line:clean(raw?.unit_price_line)',
  'unit_price_distance:Number(raw?.unit_price_distance)',
  'expected_price:Number(raw?.expected_price)',
  'printed_price_word:clean(raw?.printed_price_word)',
  'printed_price_mode:clean(raw?.printed_price_mode)',
  'price_delta:Number(raw?.price_delta)',
  'quantity_coordinates:',
  'ocr_page_confidence:Number(raw?.ocr_page_confidence)',
  'coverage_label:clean(raw?.coverage_label)',
  'deterministic_price_check:raw?.deterministic_price_check===true',
]) {
  assert.ok(source.includes(field), `TERNO exact matcher postrádá parserové pole ${field}.`);
}
for (const scopeCheck of [
  "String(row.coverage_scope||'')!==scope.coverage_scope",
  "String(row.region_code||'')!==scope.region_code",
  "String(row.city_name||'')!==scope.city_name",
  "String(row.store_location_name||'')!==scope.store_location_name",
]) {
  assert.ok(source.includes(scopeCheck), `TERNO exact matcher postrádá scope kontrolu ${scopeCheck}.`);
}
assert.match(source, /const legacyHash=`terno-ocr-safe-v5-\$\{sourceImport\.id\}`/,
  'První v6 běh musí umět bezpečně rozpoznat aktuální v5 import.');
assert.match(source, /legacy\.data\?\.status==='published'&&await storedImportMatches/,
  'Legacy v5 import se smí reuseovat jen po exact payload porovnání.');
assert.match(source, /full_payload_hash_version:PAYLOAD_CONTRACT/,
  'Ověřený TERNO import musí mít v metadata verzi full-payload hashe.');
assert.match(source, /full_payload_sha256:fullPayloadSha256/,
  'TERNO SHA musí být uložen v metadata a vracen v diagnostice.');
assert.match(source, /update\(\{metadata\}\)\.eq\('id',legacy\.data\.id\)/,
  'Legacy reuse smí doplnit pouze metadata a nesmí měnit identitu importu.');
assert.doesNotMatch(source, /update\(\{source_hash:hash,metadata\}\)/,
  'Existující TERNO source_hash je immutable a nesmí se přepisovat.');
assert.match(source, /legacy_source_hash_retained:true/,
  'Diagnostika musí explicitně přiznat zachování legacy source_hash.');
assert.match(source, /migrated_legacy_hash:!alreadyVerified/,
  'První metadata backfill musí být odlišený od běžného opakovaného reuse.');
assert.match(source, /throw new Error\('TERNO v6 payload hash odpovídá importu, ale publikované položky se liší/,
  'Kolize nebo drift existujícího v6 importu musí skončit fail-closed.');
assert.match(source, /if\(dryRun\) return json\([\s\S]*full_payload_sha256:fullPayloadSha256/,
  'Dry-run musí vracet full-payload SHA bez publish zásahu.');
assert.match(source, /function allowed\(req:Request\)[\s\S]*Bearer \$\{SERVICE_ROLE_KEY\}[\s\S]*x-cron-secret/,
  'verify_jwt=false je bezpečné pouze při zachované vlastní service-role/cron autentizaci.');

console.log('TERNO full-payload reuse contract OK');
