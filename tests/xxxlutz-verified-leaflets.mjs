import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline = fs.readFileSync('supabase/migrations/20260823130219_create_xxxlutz_verified_leaflets_pipeline.sql', 'utf8');
const fix = fs.readFileSync('supabase/migrations/20260823130519_fix_xxxlutz_state_signature_column.sql', 'utf8');
const retry = fs.readFileSync('supabase/migrations/20260824080827_retry_transient_xxxlutz_leaflets_fetch.sql', 'utf8');
const guard = fs.readFileSync('supabase/migrations/20260824082713_align_xxxlutz_guard_with_current_discount_cards.sql', 'utf8');

assert(pipeline.includes('https://r.jina.ai/https://www.xxxlutz.cz/c/letaky'), 'XXXLutz must fetch the current official leaflets page through the verified reader path.');
assert(pipeline.includes("'X-With-Links-Summary','true'"), 'XXXLutz must request link summary for stable product identity.');
assert(pipeline.includes("'xxxlutz:' || u.product_key"), 'XXXLutz external identity must use the official product key.');
assert(pipeline.includes("https://www[.]xxxlutz[.]cz/p/"), 'XXXLutz parser must restrict product identity to official /p/ URLs.');
assert(pipeline.includes("https://media[.]xxxlutz[.]com/"), 'XXXLutz parser must restrict product images to the official media host.');
assert(pipeline.includes("'validity_policy','daily_verified_snapshot'"), 'XXXLutz must explicitly use daily verified validity rather than inventing campaign dates.');
assert(pipeline.includes("now() at time zone 'Europe/Prague'"), 'XXXLutz snapshots must use the Czech business date.');
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

assert(retry.includes('v_retry<2'), 'XXXLutz transient fetch retries must be bounded to two attempts.');
assert(retry.includes("v_source_url='https://www.xxxlutz.cz/c/letaky'"), 'XXXLutz retries must be restricted to the exact official leaflets URL.');
assert(retry.includes("'retry_count',v_retry+1"), 'XXXLutz retries must carry an explicit retry counter.');
assert(retry.includes("'retry_of_request_id',j.request_id"), 'XXXLutz retry audit must retain the failed request lineage.');
assert(retry.includes("'retry_exhausted',true"), 'XXXLutz must stop after the bounded retry budget is exhausted.');
assert(retry.includes("length(coalesce(r.content,''))<15000"), 'XXXLutz retries must not relax the 15k response-size safety guard.');
assert(retry.includes("like '%human verification%'"), 'XXXLutz retries must preserve challenge-page rejection.');

assert(guard.includes('coalesce(v_count,0)<4') && guard.includes('coalesce(v_count,0)>20'), 'XXXLutz final publication range must accept 4–20 verified discount cards.');
assert(guard.includes("regexp_matches(coalesce(r.content,''), 'SLEVA[[:space:]]+[0-9]+%', 'g')"), 'XXXLutz must count official SLEVA markers independently from parser rows.');
assert(guard.includes('v_discount_markers<>v_count'), 'XXXLutz must reject any run without 100% parser coverage of SLEVA markers.');
assert(guard.includes("'discount_markers',v_discount_markers,'marker_coverage',1.0"), 'XXXLutz must persist marker coverage evidence on successful runs.');
assert(guard.includes("'discount_marker_coverage_required',1.0"), 'XXXLutz sync state must declare the 100% marker coverage contract.');
assert(guard.includes('minimum_offer_count=4'), 'XXXLutz operational health must use the current safe minimum of four verified cards.');
assert(guard.includes('expected_offer_count=v_count'), 'XXXLutz successful health state must learn the verified current campaign size.');
assert(guard.includes("length(coalesce(r.content,''))<15000"), 'XXXLutz final guard must preserve the 15k response-size floor.');
assert(guard.includes('v_retry<2'), 'XXXLutz final reconciler must retain bounded transient retries.');
assert(guard.includes('revoke all on function public.trigger_xxxlutz_verified_sync() from public,anon,authenticated;'), 'XXXLutz trigger must remain private after guard alignment.');
assert(guard.includes('revoke all on function public.reconcile_xxxlutz_verified_sync() from public,anon,authenticated;'), 'XXXLutz reconciler must remain private after guard alignment.');

console.log('XXXLutz verified leaflets contract OK');
