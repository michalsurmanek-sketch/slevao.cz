import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/sync-flop-pdf-products/index.ts','utf8');

assert.match(source, /payload_contract:'flop-pdf-spatial-safe-v4'/,
  'FLOP v3 parser musí mít samostatně verzovaný v4 payload/reuse kontrakt.');
assert.match(source, /crypto\.subtle\.digest\('SHA-256'/,
  'FLOP reuse fingerprint musí používat SHA-256.');
for (const needle of [
  "parser_contract:'flop-pdf-spatial-unit-price-v3'",
  'source_import_id:String(src.id)',
  "source_document_url:String(src.source_document_url || '')",
  'valid_from:validity.from',
  'valid_to:validity.to',
  "coverage_scope:'store'",
  "store_location_name:'FLOP TOP'",
  'rows,',
]) {
  assert.ok(source.includes(needle), `FLOP full-payload hash postrádá ${needle}.`);
}
assert.match(source, /const hash = `flop-pdf-spatial-safe-v4-\$\{fullPayloadSha256\}`/,
  'Nové importy musí být identifikované full-payload hashem, ne pouze source import ID.');
assert.doesNotMatch(source,
  /const hash = `flop-pdf-spatial-safe-v3-\$\{src\.id\}`;[\s\S]{0,350}if \(old\?\.status === 'published'\) return json/,
  'Starý slabý source-id-only reuse se nesmí vrátit.');
assert.match(source, /async function storedImportMatches\(/,
  'Published reuse musí ověřit uložené import-items.');
assert.match(source, /\.select\('title,price,quantity_text,source_page,confidence,raw_data,status'\)/,
  'Exact reuse kontrola musí číst celý deterministický parserový kontrakt položek.');
assert.match(source, /if \(\(items \|\| \[\]\)\.some\(\(item:any\) => item\.status !== 'published'\)\) return false/,
  'Reuse nesmí přijmout částečně publikovaný import.');
assert.match(source, /sameStoredPayload\(items \|\| \[\],candidates\)/,
  'Počet položek sám nestačí; musí se porovnat celý uložený payload.');
assert.match(source, /title:`\$\{row\.title\} · \$\{row\.quantity_text\}`/,
  'Legacy matcher musí respektovat DB display-title trigger, který připojuje množství.');
for (const field of [
  'unit_price:Number(raw?.unit_price)',
  'unit_price_unit:clean(raw?.unit_price_unit)',
  'expected_price:Number(raw?.expected_price)',
  'printed_price:clean(raw?.printed_price)',
  'price_delta:Number(raw?.price_delta)',
  'quantity_coordinates:',
  'price_coordinates:',
]) {
  assert.ok(source.includes(field), `FLOP exact matcher postrádá parserové pole ${field}.`);
}
assert.match(source, /const legacyHash = `flop-pdf-spatial-safe-v3-\$\{src\.id\}`/,
  'První v4 běh musí umět bezpečně rozpoznat aktuální v3 import.');
assert.match(source, /legacy\?\.status === 'published' && await storedImportMatches/,
  'Legacy v3 import se smí reuseovat jen po exact payload porovnání.');
assert.match(source, /full_payload_hash_version:'flop-pdf-spatial-safe-v4'/,
  'Ověřený legacy import musí dostat explicitní verzi full-payload hashe.');
assert.match(source, /full_payload_sha256:fullPayloadSha256/,
  'Hash musí být uložen v metadata a vracen v diagnostice.');
assert.match(source, /throw new Error\('FLOP v4 payload hash odpovídá importu, ale publikované položky se liší/,
  'Kolize nebo drift existujícího v4 importu musí skončit fail-closed, ne republish/reuse.');
assert.match(source, /if \(body\.dry_run !== false\)[\s\S]*full_payload_sha256:fullPayloadSha256/,
  'Dry-run musí zpřístupnit hash pro bezpečnou diagnostiku bez publish zásahu.');
assert.match(source, /function allowed\(req: Request\)[\s\S]*Bearer \$\{KEY\}[\s\S]*x-cron-secret/,
  'verify_jwt=false je bezpečné pouze při zachované vlastní service-role/cron autentizaci.');

console.log('FLOP full-payload reuse contract OK');
