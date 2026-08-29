import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync('supabase/functions/sync-billa-publitas/index.ts','utf8');
const productSource=fs.readFileSync('supabase/functions/sync-billa-products/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260825184500_schedule_billa_publitas_rollover.sql','utf8');

assert.match(source,/Europe\/Prague/);
assert.match(source,/function fallbackCampaigns\(/);
assert.match(source,/campaignForStart\(addDays\(current,7\)\)/);
assert.match(source,/velky-letak-/);
assert.match(source,/api\.publitas\.com\/v1\/groups/);
assert.match(source,/downloadPdfUrl/);
assert.match(source,/range:'bytes=0-7'/);
assert.match(source,/prefix\.startsWith\('%PDF-'\)/);
assert.match(source,/function canonicalPdf\(/);
assert.match(source,/u\.search=''/);
assert.match(source,/u\.hash=''/);
assert.match(source,/verified_pipeline!==true/);
assert.match(source,/\['store:billa',''\]\.includes/);
assert.match(source,/canonicalPdf\(String\(x\.source_document_url/);
assert.match(source,/db\.rpc\('reconcile_billa_verified_pipeline'\)/);
assert.doesNotMatch(source,/velky-letak-12-8-18-8-2026/);

assert.match(productSource,/replace\(\/Ȍ\/g,'fi'\)/,
  'BILLA PDF font repair must map the observed Ȍ ligature glyph to fi.');
assert.match(productSource,/function joinLineTokens\(/,
  'BILLA coordinate parser must join touching PDF glyph fragments.');
assert.match(productSource,/gap<=0\.35\?'':' '/,
  'Only touching or overlapping glyph fragments may be joined.');
assert.match(productSource,/text:joinLineTokens\(g\.tokens\)/,
  'Line grouping must use the guarded glyph joiner.');
assert.match(productSource,/bezna cena\|novinka\|vice druhu/,
  'The standalone NOVINKA badge must be excluded from product titles.');
assert.match(productSource,/parser:'billa-coordinate-v3'/,
  'BILLA title-repair semantics must use parser contract v3.');
assert.doesNotMatch(productSource,/parser:'billa-coordinate-v2'/,
  'New BILLA parser output must not claim the old v2 contract.');

const repairText=(value)=>String(value??'').replace(/Ȍ/g,'fi').replace(/\s+/g,' ').trim();
const joinLineTokens=(tokens)=>{
  const sorted=[...tokens].sort((a,b)=>a.x-b.x);
  let out='',prev=null;
  for(const token of sorted){
    const text=repairText(token.text);if(!text)continue;
    const gap=prev?token.x-(prev.x+Math.max(0,prev.width)):Number.POSITIVE_INFINITY;
    out+=out?`${gap<=0.35?'':' '}${text}`:text;
    prev=token;
  }
  return repairText(out);
};

assert.equal(repairText('Dr. Oetker GelȌx extra 2:1'),'Dr. Oetker Gelfix extra 2:1');
assert.equal(joinLineTokens([
  {text:'K',x:382.1,width:5.4},
  {text:'uskus',x:387.3,width:24.0},
]),'Kuskus','Touching BILLA PDF glyphs must reconstruct Kuskus.');
assert.equal(joinLineTokens([
  {text:'K',x:10,width:5},
  {text:'uskus',x:17,width:24},
]),'K uskus','A real inter-word gap must remain a space.');

assert.match(migration,/invoke_billa_publitas_sync/);
assert.match(migration,/sync-billa-publitas-rollover/);
assert.match(migration,/'17 \*\/3 \* \* \*'/);
assert.match(migration,/revoke all on function public\.invoke_billa_publitas_sync\(\) from public, anon, authenticated/);

console.log('Billa Publitas rollover and coordinate text regression OK');
