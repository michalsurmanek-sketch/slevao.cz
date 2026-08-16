import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260816223000_public_offer_metrics.sql', import.meta.url), 'utf8');

assert.match(migration, /create or replace function public\.get_public_offer_metrics\(\)/i, 'Public offer metrics function must exist.');
assert.match(migration, /security invoker/i, 'Metrics function must remain SECURITY INVOKER.');
assert.match(migration, /o\.status\s*=\s*'published'/i, 'Only published offers belong to public metrics.');
assert.match(migration, /o\.is_verified\s+is\s+true/i, 'Only verified offers belong to public metrics.');
assert.match(migration, /timezone\('Europe\/Prague', now\(\)\)\)::date/i, 'Metrics must use Prague-local date boundaries.');
assert.match(migration, /o\.valid_to\s*>=\s*\(timezone\('Europe\/Prague', now\(\)\)\)::date/i, 'Expired offers must be excluded.');
assert.match(migration, /o\.valid_from\s*<=\s*\(timezone\('Europe\/Prague', now\(\)\)\)::date\s*\+\s*7/i, 'Frontend window must remain seven days.');
assert.match(migration, /row_number\(\) over/i, 'Metrics must deduplicate eligible offers before counting displayable rows.');
assert.match(migration, /partition by[\s\S]*s\.slug[\s\S]*o\.valid_from[\s\S]*o\.valid_to/i, 'Metrics dedupe identity must include store and validity window.');
assert.match(migration, /current_displayable/i, 'Metrics must expose current displayable count.');
assert.match(migration, /upcoming_displayable/i, 'Metrics must expose upcoming displayable count separately.');
assert.match(migration, /grant execute on function public\.get_public_offer_metrics\(\) to anon, authenticated, service_role/i, 'Public read-only metrics must be executable by frontend roles.');

console.log('public-offer-metrics: ok');
