import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline = fs.readFileSync('supabase/migrations/20260823130219_create_xxxlutz_verified_leaflets_pipeline.sql', 'utf8');
const fix = fs.readFileSync('supabase/migrations/20260823130519_fix_xxxlutz_state_signature_column.sql', 'utf8');

assert(pipeline.includes('https://r.jina.ai/https://www.xxxlutz.cz/c/letaky'), 'XXXLutz must fetch the current official leaflets page through the verified reader path.');
assert(pipeline.includes("'X-With-Links-Summary','true'"), 'XXXLutz must request link summary for stable product identity.');
assert(pipeline.includes("'xxxlutz:' || u.product_key"), 'XXXLutz external identity must use the official product key.');
assert(pipeline.includes("https://www[.]xxxlutz[.]cz/p/"), 'XXXLutz parser must restrict product identity to official /p/ URLs.');
assert(pipeline.includes("https://media[.]xxxlutz[.]com/"), 'XXXLutz parser must restrict product images to the official media host.');
assert(pipeline.includes("'validity_policy','daily_verified_snapshot'"), 'XXXLutz must explicitly use daily verified validity rather than inventing campaign dates.');
assert(pipeline.includes("now() at time zone 'Europe/Prague'"), 'XXXLutz snapshots must use the Czech business date.');
assert(pipeline.includes('coalesce(v_count,0)<8') && pipeline.includes('coalesce(v_count,0)>20'), 'XXXLutz publication must stay fail-closed to 8–20 verified rows.');
assert(pipeline.includes('v_distinct<>v_count'), 'XXXLutz must reject duplicate external identities.');
assert(pipeline.includes("source_url='https://www.xxxlutz.cz/c/letaky'"), 'XXXLutz source must replace the obsolete /c/letak path with /c/letaky.');
assert(pipeline.includes("automation_mode='dedicated'"), 'XXXLutz source ownership must be dedicated.');
assert(pipeline.includes("adapter_key='xxxlutz-jina-leaflets-v1'"), 'XXXLutz source must point at its dedicated adapter.');
assert(pipeline.includes("extraction_strategy='structured_markdown'"), 'XXXLutz source must use structured markdown extraction.');
assert(pipeline.includes('revoke all on function public.trigger_xxxlutz_verified_sync() from public,anon,authenticated;'), 'XXXLutz trigger must not be public.');
assert(pipeline.includes('revoke all on function public.reconcile_xxxlutz_verified_sync() from public,anon,authenticated;'), 'XXXLutz reconciler must not be public.');
assert(pipeline.includes("'sync-xxxlutz-verified-products'"), 'XXXLutz verified sync cron must exist.');
assert(pipeline.includes("'21 */6 * * *'"), 'XXXLutz verified sync must run every six hours.');
assert(pipeline.includes("'reconcile-xxxlutz-verified-products'"), 'XXXLutz reconciler cron must exist.');
assert(pipeline.includes("'3-58/5 * * * *'"), 'XXXLutz reconciler must process queued requests every five minutes.');

assert(fix.includes('last_source_signature=v_signature'), 'XXXLutz follow-up migration must persist the source signature in the real schema column.');
assert(!fix.includes('last_signature=v_signature'), 'XXXLutz follow-up migration must not reference the nonexistent last_signature column.');
assert(fix.includes('last_checksum=v_signature'), 'XXXLutz follow-up migration must persist the checksum.');
assert(fix.includes('revoke all on function public.reconcile_xxxlutz_verified_sync() from public,anon,authenticated;'), 'XXXLutz fixed reconciler must stay private.');

console.log('XXXLutz verified leaflets contract OK');
