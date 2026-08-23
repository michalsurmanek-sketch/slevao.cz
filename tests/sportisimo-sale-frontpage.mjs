import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline = fs.readFileSync('supabase/migrations/20260823123112_create_sportisimo_verified_sale_frontpage_pipeline.sql', 'utf8');
const source = fs.readFileSync('supabase/migrations/20260823123456_register_sportisimo_verified_sale_source.sql', 'utf8');

assert(pipeline.includes('https://r.jina.ai/https://www.sportisimo.cz/vyprodej/'), 'Sportisimo must read the official sale page through the verified reader path.');
assert(pipeline.includes("'X-With-Links-Summary','true'"), 'Sportisimo must request link summary for stable product identity.');
assert(pipeline.includes("'sportisimo:'||u.product_id"), 'Sportisimo external identity must use the official numeric product id.');
assert(pipeline.includes("substring(line from 'https://www[.]sportisimo[.]cz/[^/ )]+/[^/ )]+/([0-9]+)/')"), 'Sportisimo parser must extract numeric product ids from official product URLs.');
assert(pipeline.includes("'sale_frontpage_strict_identity'"), 'Sportisimo partial coverage must be explicitly labelled.');
assert(pipeline.includes("coalesce(v_count,0)<30") && pipeline.includes("coalesce(v_count,0)>60"), 'Sportisimo publication must stay fail-closed to 30–60 verified rows.');
assert(pipeline.includes('v_distinct<>v_count'), 'Sportisimo must reject duplicate external identities.');
assert(pipeline.includes("health_status='waiting_source'"), 'Future or expired campaigns must become waiting_source, not a false parser error.');
assert(pipeline.includes("health_status='error'"), 'Real source/parser failures must remain errors.');
assert(pipeline.includes("now() at time zone 'Europe/Prague'"), 'Campaign validity must use the Czech business date.');
assert(pipeline.includes("set search_path = public, net, pg_temp"), 'Privileged Sportisimo sync functions must keep a fixed search_path.');
assert(pipeline.includes('revoke all on function public.trigger_sportisimo_verified_sync() from public, anon, authenticated;'), 'Sportisimo trigger must not be public.');
assert(pipeline.includes('revoke all on function public.reconcile_sportisimo_verified_sync() from public, anon, authenticated;'), 'Sportisimo reconciler must not be public.');
assert(pipeline.includes("cron.schedule('sync-sportisimo-verified-products','17 */6 * * *'"), 'Sportisimo verified sync must run every six hours.');
assert(pipeline.includes("cron.schedule('reconcile-sportisimo-verified-products','*/5 * * * *'"), 'Sportisimo reconciler must process queued requests.');

assert(source.includes("'https://www.sportisimo.cz/vyprodej/'"), 'Sportisimo source must remain the canonical official sale URL.');
assert(source.includes("'dedicated'"), 'Sportisimo source ownership must remain dedicated.');
assert(source.includes("'sportisimo-jina-sale-frontpage-v1'"), 'Sportisimo source must point at its dedicated adapter.');
assert(source.includes("'structured_markdown'"), 'Sportisimo source must use the structured markdown strategy.');
assert(source.includes('manual_fallback_enabled'), 'Sportisimo source registration must explicitly control manual fallback.');

console.log('Sportisimo verified sale frontpage contract OK');
