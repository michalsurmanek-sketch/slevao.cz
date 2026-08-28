import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/sync-jip-pack-products/index.ts','utf8');

assert.match(source, /const PAYLOAD_CONTRACT = 'jip-main-price-full-payload-v8'/,
  'JIP musí mít samostatně verzovaný v8 full-payload reuse kontrakt.');
assert.match(source, /crypto\.subtle\.digest\('SHA-256'/,
  'JIP reuse fingerprint musí používat SHA-256.');
for (const needle of [
  'payload_contract:PAYLOAD_CONTRACT',
  'parser_contract:PARSER',
  'parser_endpoint:PARSER_ENDPOINT',
  'source_adapter:SOURCE_ADAPTER',
  'derived_adapter:DERIVED_ADAPTER',
  'ocr_engine:OCR_ENGINE',
  'source_import_id:String(source.id)',
  "source_hash:String(source.source_hash||'')",
  "source_document_url:String(source.source_document_url||'')",
  "valid_from:String(source.detected_valid_from||'')",
  "valid_to:String(source.detected_valid_to||'')",
  "coverage_scope:String(source.coverage_scope||'national')",
  "region_code:String(source.region_code||'')",
  "city_name:String(source.city_name||'')",
  "store_location_name:String(source.store_location_name||'')",
  'rows:stableSort(candidates.map(parserRow))',
]) {
  assert.ok(source.includes(needle), `JIP full-payload hash postrádá ${needle}.`);
}
assert.match(source, /const hash=`jip-main-price-v8-\$\{fullPayloadSha256\}`/,
  'Nové JIP importy musí být identifikované full-payload SHA-256 hashem.');
assert.doesNotMatch(source,
  /const hash = `jip-main-price-v7-\$\{source\.id\}`;[\s\S]{0,300}existing\?\.status === 'published'\) return/,
  'Starý source-id-only JIP reuse se nesmí vrátit.');
assert.match(source, /async function storedImportMatches\(/,
  'Published JIP reuse musí ověřit uložené import-items.');
assert.match(source, /\.select\('title,price,quantity_text,source_page,confidence,raw_data,status'\)/,
  'JIP exact reuse musí číst celý deterministický parserový kontrakt položek.');
assert.match(source, /some\(\(item:any\)=>item\.status!=='published'\)\) return false/,
  'JIP reuse nesmí přijmout částečně publikovaný import.');
assert.match(source, /return sameStoredPayload\(q\.data\|\|\[\],candidates\)/,
  'JIP musí porovnávat celý uložený payload, ne pouze počet položek.');
assert.match(source, /function storedBaseTitle\(item:any\)[\s\S]*suffix=quantity\?` · \$\{quantity\}`:''[\s\S]*title\.endsWith\(suffix\)/,
  'Legacy matcher smí odstranit jen přesný display suffix množství.');
for (const field of [
  'parser:clean(raw?.parser)',
  'deterministic:raw?.deterministic===true',
  'verified_main_price:raw?.verified_main_price===true',
  'price_mode:clean(raw?.price_mode)',
  'ocr_engine:clean(raw?.ocr_engine)',
  'ocr_confidence:canonicalJson(raw?.ocr_confidence||{})',
  'evidence:canonicalJson(raw?.evidence||{})',
]) {
  assert.ok(source.includes(field), `JIP exact matcher postrádá parserové pole ${field}.`);
}
for (const scopeCheck of [
  "String(row.coverage_scope||'')!==scope.coverage_scope",
  "String(row.region_code||'')!==scope.region_code",
  "String(row.city_name||'')!==scope.city_name",
  "String(row.store_location_name||'')!==scope.store_location_name",
]) {
  assert.ok(source.includes(scopeCheck), `JIP exact matcher postrádá scope kontrolu ${scopeCheck}.`);
}
assert.match(source, /const legacyHash=`jip-main-price-v7-\$\{source\.id\}`/,
  'První v8 běh musí umět bezpečně rozpoznat aktuální v7 import.');
assert.match(source, /legacy\.data\?\.status==='published' && await storedImportMatches/,
  'Legacy v7 import se smí reuseovat jen po exact payload porovnání.');
assert.match(source, /full_payload_hash_version:PAYLOAD_CONTRACT/,
  'Ověřený JIP import musí mít v metadata verzi full-payload hashe.');
assert.match(source, /full_payload_sha256:fullPayloadSha256/,
  'JIP SHA musí být uložen v metadata a vracen v diagnostice.');
assert.match(source, /update\(\{metadata\}\)\.eq\('id',legacy\.data\.id\)/,
  'Legacy reuse smí doplnit pouze metadata a nesmí měnit identitu importu.');
assert.doesNotMatch(source, /update\(\{source_hash:hash,metadata\}\)/,
  'Existující JIP source_hash je immutable a nesmí se přepisovat.');
assert.match(source, /legacy_source_hash_retained:true/,
  'Diagnostika musí explicitně přiznat zachování legacy source_hash.');
assert.match(source, /migrated_legacy_hash:!alreadyVerified/,
  'První metadata backfill musí být odlišený od běžného opakovaného reuse.');
assert.match(source, /throw new Error\('JIP v8 payload hash odpovídá importu, ale publikované položky se liší/,
  'Kolize nebo drift existujícího v8 importu musí skončit fail-closed.');
assert.match(source, /if \(dryRun\) return J\(summary\)/,
  'Dry-run musí skončit před jakýmkoli publish zápisem.');
assert.match(source, /adapter_version:'v8'/,
  'Health stav musí reportovat aktuální JIP v8 publisher kontrakt.');
assert.match(source, /function ok\(r: Request\)[\s\S]*Bearer \$\{K\}[\s\S]*x-cron-secret/,
  'verify_jwt=false je bezpečné pouze při zachované vlastní service-role/cron autentizaci.');

console.log('JIP main-price full-payload reuse contract OK');
