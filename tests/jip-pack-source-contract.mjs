import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync('supabase/functions/sync-jip-pack-products/index.ts', 'utf8');
const parser = fs.readFileSync('supabase/functions/debug-jip-main-price-v5/index.ts', 'utf8');

assert(sync.includes("const SOURCE_ADAPTER = 'jip-flip-pdf-v1';"), 'JIP sync must stay attached to the official flip source adapter.');
assert(sync.includes('const SOURCE_PAGE_COUNT = 12;'), 'JIP sync must keep the 12-page Maloobchod source contract.');
assert(sync.includes("const OCR_ENGINE = 'tesseract-cli-ces-jip-v2';"), 'JIP publication must use the quote-safe OCR v2 engine only.');
assert(sync.includes("const PARSER_ENDPOINT = 'debug-jip-main-price-v5';"), 'JIP production sync must call the direct-main-price parser.');
assert(sync.includes("const PARSER = 'jip-main-price-v7-direct-decimal';"), 'JIP derived parser revision must stay explicit.');
assert(sync.includes("const DERIVED_ADAPTER = 'jip-ocr-main-price-v7';"), 'JIP derived adapter revision must stay explicit.');
assert(sync.includes("const PAYLOAD_CONTRACT = 'jip-main-price-full-payload-v8';"), 'JIP publication must pin the full-payload v8 reuse contract.');
assert(sync.includes("x?.status === 'published'"), 'JIP source must itself be a published current source.');
assert(sync.includes("images.length === SOURCE_PAGE_COUNT"), 'JIP source must provide all 12 page images.');
assert(sync.includes('/\\/MO-\\d{1,2}-\\d{1,2}-\\d{4}\\/$/i'), 'JIP source must be the official MO-* Maloobchod flipbook.');
assert(sync.includes(".eq('engine', OCR_ENGINE)"), 'JIP publication must isolate OCR pages by engine.');
assert(sync.includes('(ocrPages || []).length !== 12 || uniquePages.size !== 12'), 'JIP publication must require exactly 12 unique OCR v2 pages.');
assert(sync.includes("c?.price_mode !== 'direct-decimal'"), 'JIP publisher must reject every non-direct OCR price mode.');
assert(sync.includes("!/^.*\\d{1,4}[,.]\\d{2}.*$/.test(rawPrice)"), 'JIP publisher must require a directly read decimal price token.');
assert(sync.includes("Number(c?.conf?.price || 0) < 60"), 'JIP direct-price OCR confidence floor must remain fail-closed.');
assert(sync.includes("Number(c?.conf?.title || 0) < 80"), 'JIP title confidence floor must remain fail-closed.');
assert(sync.includes("Number(c?.conf?.qty || 0) < 65"), 'JIP quantity confidence floor must remain fail-closed.');
assert(sync.includes('function ambiguousBrandOnly'), 'JIP must retain the ambiguous producer/brand-only title guard.');
assert(sync.includes('expected 5-20 direct-price candidates'), 'JIP candidate-count guard must remain fail-closed.');
assert(sync.includes('if (accepted < 5)'), 'JIP publication must fail if too few rows survive publish-imports.');
assert(sync.includes('const fullPayloadSha256=await payloadHash(candidates,source);'), 'JIP live identity must be derived from the complete verified payload.');
assert(sync.includes('const hash=`jip-main-price-v8-${fullPayloadSha256}`;'), 'JIP v8 rerun identity must change when the verified payload changes.');
assert(sync.includes("current.data?.status==='published'"), 'JIP v8 live reruns must recognize an already published payload hash.');
assert(sync.includes('storedImportMatches(current.data as ExistingImport,candidates,source)'), 'JIP v8 reuse must verify the stored published rows before reuse.');
assert(sync.includes('const legacyHash=`jip-main-price-v7-${source.id}`;'), 'JIP v8 must keep a migration path for verified legacy v7 imports.');
assert(sync.includes("legacy.data?.status==='published' && await storedImportMatches"), 'JIP legacy reuse must also verify the exact stored payload.');
assert(sync.includes('full_payload_hash_version:PAYLOAD_CONTRACT'), 'JIP derived import must persist the payload-contract version.');
assert(sync.includes('full_payload_sha256:fullPayloadSha256'), 'JIP derived import must persist the full verified payload hash.');
assert(sync.includes('reused:true'), 'JIP reused rerun state must remain explicit.');
assert(sync.includes('partial_coverage:true'), 'JIP v7 parser snapshot must declare intentionally partial coverage.');
assert(sync.includes("health_status:'degraded'"), 'JIP partial safe snapshot must not pretend to be full healthy coverage.');
assert(sync.includes("source_contract:'maloobchod-12-page-direct-main-price-v7'"), 'JIP derived import must preserve the direct-main-price source contract.');
assert(!sync.includes('debug-jip-pack-parser'), 'Unsafe legacy JIP v4 pack parser must never return to the production publisher.');
assert(!sync.includes('jip-ocr-pack-v4'), 'Unsafe legacy JIP v4 derived adapter must not be published again.');

assert(parser.includes('function directDecimal'), 'JIP parser must parse only explicit decimal price glyphs.');
assert(parser.includes('function unitMarker'), 'JIP parser must explicitly identify unit-price context.');
assert(parser.includes("price_mode:'direct-decimal'"), 'JIP parser output must identify direct decimal evidence.');
assert(parser.includes('x.l.maxHeight>=40'), 'JIP main price must come from a visually large OCR price line.');
assert(parser.includes('x.l.priceConf>=60'), 'JIP main price must meet the decimal-token OCR confidence floor.');
assert(parser.includes("(unit==='kg'||unit==='l')&&amount>5"), 'JIP parser must reject implausible OCR quantities over 5 kg/l.');
assert(parser.includes("(unit==='g'||unit==='ml')&&amount>5000"), 'JIP parser must reject implausible OCR quantities over 5000 g/ml.');
assert(parser.includes("unit==='ks'&&amount>100"), 'JIP parser must reject implausible OCR piece counts.');
assert(parser.includes("pages.length!==12||new Set(pages.map((p:any)=>p.page_number)).size!==12"), 'JIP parser itself must require the complete 12-page OCR set.');
assert(!parser.includes('superscript-90'), 'JIP parser must never infer .90 from superscript OCR glyphs.');
assert(!parser.includes('degree'), 'JIP parser must never infer price cents from degree-like glyphs.');

function fixtureDirectDecimal(s) {
  const m = String(s).match(/(?:^|[^0-9])(\d{1,4})[,.](\d{2})(?:[^0-9]|$)/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 100;
}
function fixtureUnitMarker(s) {
  const n = String(s).toLowerCase();
  return /\b(?:100\s*(?:g|ml)|1\s*(?:kg|l|ks))\b.*(?:=|od)/.test(n)
    || /(?:^|\s)od\s+\d/.test(n)
    || /\/(?:kg|l|100\s*g|100\s*ml)\b/.test(n);
}

assert.equal(fixtureDirectDecimal('| 14,90'), 14.9, 'Decorative bar beside a direct price must not hide the actual decimal price.');
assert.equal(fixtureDirectDecimal('46°°'), null, 'Stylized/garbled superscript price must remain untrusted.');
assert.equal(fixtureUnitMarker('100 g = 13,03'), true, '100 g unit-price lines must be recognized as unit evidence, never main prices.');
assert.equal(fixtureUnitMarker('100 ml od 24,34'), true, '100 ml od unit-price lines must be recognized as unit evidence.');
assert.equal(fixtureUnitMarker('1 kg = 23,40'), true, '1 kg = unit-price lines must be rejected as main-price context.');
assert.equal(fixtureUnitMarker('1 kg'), false, 'Plain 1 kg must remain a valid product quantity.');
assert.equal(fixtureUnitMarker('500 g'), false, 'Plain product weight must not be mistaken for unit-price context.');

console.log('JIP direct-price v7 parser / v8 payload-contract regression OK');
