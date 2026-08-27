import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/sync-globus-products/index.ts', 'utf8');
const scoped = fs.readFileSync('supabase/migrations/20260823074348_publish_globus_olomouc_scoped_snapshot.sql', 'utf8');
const schedule = fs.readFileSync('supabase/migrations/20260823074708_schedule_globus_full_products_sync.sql', 'utf8');
const priceFloor = fs.readFileSync('supabase/migrations/20260827115000_filter_globus_below_price_floor.sql', 'utf8');
const sourceBinding = fs.readFileSync('supabase/migrations/20260827115500_bind_globus_structured_source.sql', 'utf8');

assert(edge.includes('const HOUSE_NUMBER = 4008;'), 'Globus must use the verified Olomouc GSOA house number');
assert(edge.includes('const PAGE_SIZE = 100;'), 'Globus must use the verified 100-item API page size');
assert(edge.includes('const MIN_PRODUCTS = 300;'), 'Globus full feed must fail closed below the completeness floor');
assert(edge.includes('const MAX_REPORTED_GAP = 100;'), 'Globus reported/accessibility gap guard is missing');
assert(edge.includes('const MAX_VALIDITY_DAYS = 180;'), 'Globus must reject implausibly long action-price validity windows');
assert(edge.includes('const INVALID_VALIDITY_SENTINEL_YEAR = 2100;'), 'Globus must define a hard guard against far-future sentinel validity');
assert(edge.includes('endYear >= INVALID_VALIDITY_SENTINEL_YEAR'), 'Globus must reject sentinel years such as 9999');
assert(edge.includes('return days <= MAX_VALIDITY_DAYS;'), 'Globus action validity must remain bounded');
assert(edge.includes('invalid_validity_count: invalidValidityCount'), 'Globus diagnostics must report rejected validity windows');
assert(edge.includes("payload?.paginationShowMore === true"), 'Globus pagination must terminate from the official pagination flag');
assert(edge.includes("const price = money(house?.actualPrice);"), 'Globus public price must come from actualPrice');
assert(edge.includes("member_program: bonusPrice && price && bonusPrice < price ? 'Můj Globus' : null"), 'Member-only price must stay explicitly marked as Můj Globus metadata');
assert(edge.includes('external_id: `${HOUSE_NUMBER}:${vanr}`'), 'Globus external identity must be branch-qualified');
assert(edge.includes('requestedDryRun = body.dry_run !== false;'), 'Unqualified/manual Globus calls must remain dry-run by default');
assert(edge.includes('if (requestedDryRun)'), 'Globus must return before publication unless dry_run is explicitly false');
assert(edge.includes("db.rpc('publish_globus_olomouc_offers'"), 'Globus live sync must use the scoped transactional publisher');
assert(edge.includes("markHealth('degraded'"), 'A failed live Globus refresh must mark operational health degraded');
assert(!edge.includes("markHealth('ok'"), 'Successful Globus counts must remain authoritative in the transactional DB publisher');

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
