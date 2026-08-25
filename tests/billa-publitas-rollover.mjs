import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync('supabase/functions/sync-billa-publitas/index.ts','utf8');
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

assert.match(migration,/invoke_billa_publitas_sync/);
assert.match(migration,/sync-billa-publitas-rollover/);
assert.match(migration,/'17 \*\/3 \* \* \*'/);
assert.match(migration,/revoke all on function public\.invoke_billa_publitas_sync\(\) from public, anon, authenticated/);

console.log('Billa Publitas rollover regression OK');
