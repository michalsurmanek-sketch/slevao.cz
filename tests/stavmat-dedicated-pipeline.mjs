import assert from 'node:assert/strict';
import fs from 'node:fs';

const ownership = fs.readFileSync('supabase/migrations/20260823105446_make_stavmat_dedicated_and_archive_generic_reviews.sql', 'utf8');
const pipeline = fs.readFileSync('supabase/migrations/20260823105642_persist_stavmat_dedicated_pipeline_contract.sql', 'utf8');

assert(ownership.includes("automation_mode='dedicated'"), 'STAVMAT must remain dedicated and outside generic discovery.');
assert(ownership.includes("adapter_key='stavmat-official-promo-html-v1'"), 'STAVMAT dedicated owner must stay explicit.');
assert(ownership.includes("archive_reason','superseded_by_stavmat_dedicated_pipeline'"), 'Generic STAVMAT review work must be archived when the dedicated owner takes over.');

assert(pipeline.includes('create or replace function public.parse_stavmat_promo_html'), 'STAVMAT structured parser must be reproducible from migrations.');
assert(pipeline.includes("'price_policy','consumer_price_including_vat'"), 'STAVMAT must publish consumer gross prices, not net prices.');
assert(pipeline.includes("if v_count<30 or v_count>150"), 'STAVMAT parser must fail closed outside the verified product-count range.');
assert(pipeline.includes("health_status='waiting_source'"), 'STAVMAT must represent the absence of a current campaign as waiting_source.');
assert(pipeline.includes("revoke all on function public.apply_stavmat_latest_promo() from public,anon,authenticated"), 'STAVMAT publisher must not be executable by public client roles.');
assert(pipeline.includes("grant execute on function public.apply_stavmat_latest_promo() to service_role"), 'STAVMAT publisher must remain available to server automation.');
assert(pipeline.includes("'sync_stavmat_home_daily','10 4 * * *'"), 'STAVMAT homepage discovery cron must remain canonical.');
assert(pipeline.includes("'sync_stavmat_promo_daily','12 4 * * *'"), 'STAVMAT promo discovery cron must remain canonical.');
assert(pipeline.includes("'sync_stavmat_apply_daily','14 4 * * *'"), 'STAVMAT publish cron must remain canonical.');

console.log('STAVMAT dedicated pipeline ownership contract OK');
