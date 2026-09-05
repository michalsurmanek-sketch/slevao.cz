import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/sync-globus-products/index.ts', 'utf8');
const staged = fs.readFileSync('supabase/migrations/20260902185025_globus_chunked_publish_stage.sql', 'utf8');
const scoped = fs.readFileSync('supabase/migrations/20260823074348_publish_globus_olomouc_scoped_snapshot.sql', 'utf8');
const schedule = fs.readFileSync('supabase/migrations/20260823074708_schedule_globus_full_products_sync.sql', 'utf8');
const priceFloor = fs.readFileSync('supabase/migrations/20260827115000_filter_globus_below_price_floor.sql', 'utf8');
const sourceBinding = fs.readFileSync('supabase/migrations/20260827115500_bind_globus_structured_source.sql', 'utf8');

assert.match(edge, /\bHOUSE_NUMBER\s*=\s*4008\b/, 'Globus must use the verified Olomouc GSOA house number');
assert.match(edge, /\bPAGE_SIZE\s*=\s*100\b/, 'Globus must use the verified 100-item API page size');
assert.match(edge, /\bMIN_PRODUCTS\s*=\s*300\b/, 'Globus full feed must fail closed below the completeness floor');
assert.match(edge, /\bMAX_REPORTED_GAP\s*=\s*100\b/, 'Globus reported/accessibility gap guard is missing');
assert.match(edge, /\bMAX_VALIDITY_DAYS\s*=\s*180\b/, 'Globus must reject implausibly long action-price validity windows');
assert.match(edge, /\bINVALID_VALIDITY_SENTINEL_YEAR\s*=\s*2100\b/, 'Globus must define a hard guard against far-future sentinel validity');
assert.match(edge, />=\s*INVALID_VALIDITY_SENTINEL_YEAR/, 'Globus must reject sentinel years such as 9999');
assert.match(edge, /<=\s*MAX_VALIDITY_DAYS/, 'Globus action validity must remain bounded');
assert.match(edge, /invalid_validity_count\s*:\s*invalidValidityCount/, 'Globus diagnostics must report rejected validity windows');
assert.match(edge, /products\s*=\s*Array\.isArray\(\s*\w+\?\.products\s*\)\s*\?\s*\w+\.products\s*:\s*\[\]/, 'Globus must read the official products payload');
assert.match(edge, /paginationShowMore\s*===\s*true/, 'Globus pagination must terminate from the official pagination flag');
assert.match(edge, /price\s*=\s*money\(\s*\w+\?\.actualPrice\s*\)/, 'Globus public price must come from actualPrice');
assert.match(edge, /bonusPrice\s*=\s*money\(\s*\w+\?\.actualPrice\s*\)/, 'Globus member price must come from the official bonus-program actualPrice');
assert.match(edge, /member_program\s*:\s*bonusPrice\s*&&\s*price\s*&&\s*bonusPrice\s*<\s*price\s*\?\s*'Můj Globus'\s*:\s*null/, 'Member-only price must stay explicitly marked as Můj Globus metadata');
assert.match(edge, /external_id\s*:\s*`\$\{HOUSE_NUMBER\}:\$\{vanr\}`/, 'Globus external identity must be branch-qualified');
assert.match(edge, /\bdry\s*=\s*body\.dry_run\s*!==\s*false/, 'Unqualified/manual Globus calls must remain dry-run by default');
assert.match(edge, /if\s*\(\s*dry\s*\)\s*return\s+json\(/, 'Globus must return before publication unless dry_run is explicitly false');

assert.match(edge, /\bPUBLISH_CHUNK_SIZE\s*=\s*75\b/, 'Globus publication must stay below the database 100-row staging limit');
assert.match(edge, /db\.rpc\(\s*'stage_globus_offer_chunk'/, 'Globus live sync must stage the verified snapshot in bounded chunks');
assert.match(edge, /stagedTotal\s*!==\s*rows\.length/, 'Globus must fail closed when staging is incomplete');
assert.match(edge, /db\.rpc\(\s*'finalize_globus_staged_offers'/, 'Globus live sync must finalize only a complete staged snapshot');
assert.match(edge, /async function markHealth\([\s\S]*?health_status\s*:\s*'degraded'/, 'A failed live Globus refresh must persist degraded operational health');
assert.match(edge, /catch\(error\)[\s\S]*?if\(!dry\)await markHealth\(/, 'Only a failed live Globus refresh may mutate operational health');
assert.doesNotMatch(edge, /health_status\s*:\s*'ok'/, 'Successful Globus counts must remain authoritative in the transactional DB publisher');

assert.match(staged, /create table if not exists private\.globus_offer_stage/, 'Globus chunked publisher must use a private staging table');
assert.match(staged, /primary key\s*\(\s*signature\s*,\s*external_id\s*\)/, 'Globus staging must be idempotent per snapshot signature and product');
assert.match(staged, /v_input\s*<\s*1\s+or\s+v_input\s*>\s*100/i, 'Globus staging RPC must reject unsafe chunk sizes');
assert.match(staged, /created_at\s*<\s*now\(\)\s*-\s*interval\s*'1 day'/i, 'Abandoned Globus staging rows must be garbage-collected');
assert.match(staged, /on conflict\s*\(\s*signature\s*,\s*external_id\s*\)\s*do update/i, 'Retrying a Globus snapshot must be idempotent');
assert.match(staged, /v_count\s*<>\s*p_accessible_product_count/i, 'Globus finalize must reject incomplete staged snapshots');
assert.match(staged, /v_count\s*<\s*300\s+or\s+v_count\s*>\s*1000/i, 'Globus finalize must enforce safe snapshot bounds');
assert.match(staged, /public\.publish_globus_olomouc_offers\s*\(/, 'Globus finalize must delegate to the scoped transactional publisher');
assert.match(staged, /delete from private\.globus_offer_stage where signature\s*=\s*p_signature/i, 'Successful Globus finalize must delete its staging rows');
assert.match(staged, /revoke all on function public\.stage_globus_offer_chunk\([\s\S]*?from public/i, 'Globus staging RPC must not stay public-executable');
assert.match(staged, /grant execute on function public\.stage_globus_offer_chunk\([\s\S]*?to service_role/i, 'Globus staging RPC must remain service-only');
assert.match(staged, /revoke all on function public\.finalize_globus_staged_offers\([\s\S]*?from public/i, 'Globus finalize RPC must not stay public-executable');
assert.match(staged, /grant execute on function public\.finalize_globus_staged_offers\([\s\S]*?to service_role/i, 'Globus finalize RPC must remain service-only');

assert.match(scoped, /coverage_scope\s*=\s*'city'/, 'Globus publisher must not leave Olomouc offers national');
assert.match(scoped, /city_name\s*=\s*'Olomouc'/, 'Globus publisher must scope offers to Olomouc');
assert.match(scoped, /store_location_name\s*=\s*'Globus Olomouc'/, 'Globus store location scope is missing');
assert.match(scoped, /revoke all on function public\.publish_globus_olomouc_offers/i, 'Globus SECURITY DEFINER wrapper must not stay public-executable');
assert.match(scoped, /grant execute on function public\.publish_globus_olomouc_offers/i, 'Globus scoped publisher must be callable by service_role');

assert.match(priceFloor, /\(source\.item ->> 'price'\)::numeric\s*>=\s*2/, 'Trusted Globus rows below the global 2 CZK floor must be filtered before publication');
assert.match(priceFloor, /skipped_below_price_floor/, 'Globus must report how many sub-floor rows were skipped');
assert.doesNotMatch(priceFloor, /drop\s+constraint\s+offers_published_min_price_check/i, 'Globus must not weaken the global published-price guard');
assert.match(sourceBinding, /source_url\s*=\s*p_source_document_url/, 'Globus must bind publication to the exact active API source URL');
assert.match(sourceBinding, /v_source_id\s+is\s+distinct\s+from\s+v_expected_source_id/i, 'Globus must verify the import used the expected API source');
assert.match(sourceBinding, /raise exception 'Globus publisher used unexpected source/i, 'Wrong source ownership must roll back the batch');

assert.match(schedule, /'slevao-globus-products'/, 'Globus product cron is missing');
assert.match(schedule, /jsonb_build_object\(\s*'dry_run'\s*,\s*false\s*\)/, 'Scheduled Globus sync must explicitly publish');
assert.match(schedule, /check_interval_minutes\s*=\s*525600/, 'Generic Globus discovery must stay out of the normal product path');
assert.match(schedule, /superseded_by_globus_action_products_api_v1/, 'Legacy 8-highlight imports must be archived');

console.log('Globus full API product sync contract OK');
