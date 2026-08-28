import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/sync-norma-pdf-products/index.ts','utf8');

assert.match(source, /payload_contract:'norma-spatial-safe-v3'/,
  'NORMA musí mít samostatně verzovaný full-payload reuse kontrakt.');
assert.match(source, /crypto\.subtle\.digest\('SHA-256'/,
  'NORMA reuse fingerprint musí používat SHA-256.');
for (const needle of [
  "parser_contract:'norma-pdf-spatial-unit-price-v2'",
  'source_import_id:String(src.id)',
  "source_document_url:String(src.source_document_url||'')",
  "valid_from:String(src.detected_valid_from||'')",
  "valid_to:String(src.detected_valid_to||'')",
  "coverage_scope:String(src.coverage_scope||'')",
  "region_code:String(src.region_code||'')",
  "city_name:String(src.city_name||'')",
  'rows:stableSort(candidates.map(parserRow))',
]) {
  assert.ok(source.includes(needle), `NORMA full-payload hash postrádá ${needle}.`);
}
assert.match(source, /const hash=`norma-spatial-safe-v3-\$\{fullPayloadSha256\}`/,
  'Nové NORMA importy musí být identifikované full-payload hashem.');
assert.doesNotMatch(source,
  /const hash=`norma-spatial-safe-v2-\$\{src\.id\}`;[\s\S]{0,350}if\(old\?\.status==='published'\)return json/,
  'Starý source-id-only NORMA reuse se nesmí vrátit.');
assert.match(source, /async function storedImportMatches\(/,
  'Published NORMA reuse musí ověřit uložené import-items.');
assert.match(source, /\.select\('title,price,quantity_text,source_page,confidence,raw_data,status'\)/,
  'NORMA exact reuse musí číst celý deterministický parserový kontrakt položek.');
assert.match(source, /if\(\(items\|\|\[\]\)\.some\(\(item:any\)=>item\.status!=='published'\)\)return false/,
  'NORMA reuse nesmí přijmout částečně publikovaný import.');
assert.match(source, /return sameStoredPayload\(items\|\|\[\],candidates\)/,
  'NORMA musí porovnávat celý uložený payload, ne pouze počet položek.');
assert.match(source, /function storedBaseTitle\(item:any\)[\s\S]*suffix=quantity\?` · \$\{quantity\}`:''[\s\S]*title\.endsWith\(suffix\)/,
  'Legacy matcher smí odstranit jen přesný display suffix množství.');
for (const field of [
  'unit_price:Number(raw?.unit_price)',
  'unit_price_basis:clean(raw?.unit_price_basis)',
  'expected_price:Number(raw?.expected_price)',
  'printed_price:clean(raw?.printed_price)',
  'price_delta:Number(raw?.price_delta)',
  'quantity_token:clean(raw?.quantity_token)',
  'price_coordinates:',
  'quantity_coordinates:',
  'deterministic:raw?.deterministic===true',
]) {
  assert.ok(source.includes(field), `NORMA exact matcher postrádá parserové pole ${field}.`);
}
assert.match(source, /const legacyHash=`norma-spatial-safe-v2-\$\{src\.id\}`/,
  'První v3 běh musí umět bezpečně rozpoznat aktuální v2 import.');
assert.match(source, /legacy\?\.status==='published'&&await storedImportMatches/,
  'Legacy v2 import se smí reuseovat jen po exact payload porovnání.');
assert.match(source, /const alreadyVerified=legacy\.metadata\?\.full_payload_hash_version==='norma-spatial-safe-v3'&&legacy\.metadata\?\.full_payload_sha256===fullPayloadSha256/,
  'Legacy NORMA import musí poznat už ověřený stejný v3 payload bez opakovaného zápisu.');
assert.match(source, /full_payload_hash_version:'norma-spatial-safe-v3'/,
  'Ověřený NORMA import musí dostat explicitní verzi full-payload hashe v metadata.');
assert.match(source, /full_payload_sha256:fullPayloadSha256/,
  'NORMA hash musí být uložen v metadata a vracen v diagnostice.');
assert.match(source, /update\(\{metadata\}\)\.eq\('id',legacy\.id\)/,
  'Exact legacy reuse smí doplnit pouze metadata a nesmí měnit identitu importu.');
assert.doesNotMatch(source, /update\(\{source_hash:hash,metadata\}\)/,
  'Existující NORMA source_hash je immutable a nesmí se při legacy povýšení přepisovat.');
assert.match(source, /legacy_source_hash_retained:true/,
  'Diagnostika musí explicitně přiznat zachování původního immutable source_hash.');
assert.match(source, /migrated_legacy_hash:!alreadyVerified/,
  'První metadata backfill má být rozlišitelný od běžného opakovaného reuse.');
assert.match(source, /throw new Error\('NORMA v3 payload hash odpovídá importu, ale publikované položky se liší/,
  'Kolize nebo drift existujícího v3 importu musí skončit fail-closed.');
assert.match(source, /if\(body\.dry_run!==false\)[\s\S]*full_payload_sha256:fullPayloadSha256/,
  'Dry-run musí vracet full-payload hash bez publish zásahu.');
assert.match(source, /function allowed\(req:Request\)[\s\S]*Bearer \$\{KEY\}[\s\S]*x-cron-secret/,
  'verify_jwt=false je bezpečné pouze při zachované vlastní service-role/cron autentizaci.');

console.log('NORMA full-payload reuse contract OK');
