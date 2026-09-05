import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/sync-globus-products/index.ts', 'utf8');
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
assert.match(edge, />=\s*INVALID_VALIDITY_SENTINEL_YEAR\b/, 'Globus must reject sentinel years such as 9999');
assert.match(edge, /Math\.floor\(\(b-a\)\/86400000\)\s*<=\s*MAX_VALIDITY_DAYS/, 'Globus action validity must remain bounded');
assert.match(edge, /invalid_validity_count\s*:\s*invalidValidityCount/, 'Globus diagnostics must report rejected validity windows');
assert.match(edge, /paginationShowMore\s*===\s*true/, 'Globus pagination must terminate from the official pagination flag');
assert.match(edge, /price\s*=\s*money\(h\?\.actualPrice\)/, 'Globus public price must come from actualPrice');
assert.match(edge, /member_program\s*:\s*bonusPrice\s*&&\s*price\s*&&\s*bonusPrice\s*<\s*price\s*\?\s*'Můj Globus'\s*:\s*null/, 'Member-only price must stay explicitly marked as Můj Globus metadata');
assert.match(edge, /external_id\s*:\s*`\$\{HOUSE_NUMBER\}:\$\{vanr\}`/, 'Globus external identity must be branch-qualified');
assert.match(edge, /let\s+dry\s*=\s*true\b/, 'Unqualified/manual Globus calls must remain dry-run by default');
assert.match(edge, /dry\s*=\s*body\.dry_run\s*!==\s*false/, 'Only an explicit dry_run=false may enable publication');
assert.match(edge, /if\s*\(dry\)\s*return\s+json\(/, 'Globus must return before publication in dry-run mode');
assert.match(edge, /db\.rpc\('stage_globus_offer_chunk'/, 'Globus live sync must stage bounded chunks before publication');
assert.match(edge, /db\.rpc\('finalize_globus_staged_offers'/, 'Globus live sync must finalize through the transactional staged publisher');
assert.match(edge, /const\s+publish\s*=\s*await\s+publishChunked\(/, 'Globus live path must use the staged chunk publisher');
assert.match(edge, /health_status\s*:\s*'degraded'/, 'A failed live Globus refresh must mark operational health degraded');
assert.match(edge, /catch\(error\)[\s\S]*?if\s*\(!dry\)\s*await\s+markHealth\(/, 'Dry-run failures must not mutate operational health');
assert.doesNotMatch(edge, /health_status\s*:\s*'ok'/, 'Successful Globus counts must remain authoritative in the transactional DB publisher');

assert(scoped.includes("coverage_scope='city'"), 'Globus publisher must not leave Olomouc offers national');
assert(scoped.includes("city_name='Olomouc'"), 'Globus publisher must scope offers to Olomouc');
assert(scoped.includes("store_location_name='Globus Olomouc'"), 'Globus store location scope is missing');
assert(scoped.includes('revoke all on function public.publish_globus_olomouc_offers'), 'Globus SECURITY DEFINER wrapper must not stay public-executable');
assert(scoped.includes('grant execute on function public.publish_globus_olomouc_offers'), 'Globus scoped publisher must be callable by service_role');

assert(priceFloor.includes("(source.item ->> 'price')::numeric >= 2"), 'Trusted Globus rows below the global 2 CZK floor must be filtered before publication');
assert(priceFloor.includes('skipped_below_price_floor'), 'Globus must report how many sub-floor rows were skipped');
assert(!/drop\s+constraint\s+offers_published_min_price_check/i.test(priceFloor), 'Globus must not weaken the global published-price guard');
assert(sourceBinding.includes('source_url = p_source_document_url'), 'Globus must bind publication to the exact active API source URL');
assert(sourceBinding.includes('v_source_id is distinct from v_expected_source_id'), 'Globus must verify the import used the expected API source');
assert(sourceBinding.includes("raise exception 'Globus publisher used unexpected source"), 'Wrong source ownership must roll back the batch');

assert(schedule.includes("'slevao-globus-products'"), 'Globus product cron is missing');
assert(schedule.includes("jsonb_build_object('dry_run', false)"), 'Scheduled Globus sync must explicitly publish');
assert(schedule.includes('check_interval_minutes=525600'), 'Generic Globus discovery must stay out of the normal product path');
assert(schedule.includes("superseded_by_globus_action_products_api_v1"), 'Legacy 8-highlight imports must be archived');

console.log('Globus full API product sync contract OK');
