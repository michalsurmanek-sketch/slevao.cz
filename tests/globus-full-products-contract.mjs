import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/sync-globus-products/index.ts', 'utf8');
const scoped = fs.readFileSync('supabase/migrations/20260823074348_publish_globus_olomouc_scoped_snapshot.sql', 'utf8');
const schedule = fs.readFileSync('supabase/migrations/20260823074708_schedule_globus_full_products_sync.sql', 'utf8');

assert(edge.includes('const HOUSE_NUMBER = 4008;'), 'Globus must use the verified Olomouc GSOA house number');
assert(edge.includes('const PAGE_SIZE = 100;'), 'Globus must use the verified 100-item API page size');
assert(edge.includes('const MIN_PRODUCTS = 300;'), 'Globus full feed must fail closed below the completeness floor');
assert(edge.includes('const MAX_REPORTED_GAP = 100;'), 'Globus reported/accessibility gap guard is missing');
assert(edge.includes("payload?.paginationShowMore === true"), 'Globus pagination must terminate from the official pagination flag');
assert(edge.includes("const price = money(house?.actualPrice);"), 'Globus public price must come from actualPrice');
assert(edge.includes("member_program: bonusPrice && price && bonusPrice < price ? 'Můj Globus' : null"), 'Member-only price must stay explicitly marked as Můj Globus metadata');
assert(edge.includes('external_id: `${HOUSE_NUMBER}:${vanr}`'), 'Globus external identity must be branch-qualified');
assert(edge.includes("if (body.dry_run !== false)"), 'Unqualified/manual Globus calls must remain dry-run by default');
assert(edge.includes("db.rpc('publish_globus_olomouc_offers'"), 'Globus live sync must use the scoped transactional publisher');

assert(scoped.includes("coverage_scope='city'"), 'Globus publisher must not leave Olomouc offers national');
assert(scoped.includes("city_name='Olomouc'"), 'Globus publisher must scope offers to Olomouc');
assert(scoped.includes("store_location_name='Globus Olomouc'"), 'Globus store location scope is missing');
assert(scoped.includes('revoke all on function public.publish_globus_olomouc_offers'), 'Globus SECURITY DEFINER wrapper must not stay public-executable');
assert(scoped.includes('grant execute on function public.publish_globus_olomouc_offers'), 'Globus scoped publisher must be callable by service_role');

assert(schedule.includes("'slevao-globus-products'"), 'Globus product cron is missing');
assert(schedule.includes("jsonb_build_object('dry_run', false)"), 'Scheduled Globus sync must explicitly publish');
assert(schedule.includes('check_interval_minutes=525600'), 'Generic Globus discovery must stay out of the normal product path');
assert(schedule.includes("superseded_by_globus_action_products_api_v1"), 'Legacy 8-highlight imports must be archived');

console.log('Globus full API product sync contract OK');
