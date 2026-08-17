import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260817204500_offer_visual_fallback_staging.sql', import.meta.url), 'utf8');

assert.match(sql, /private\.offer_visual_fallback_candidates/, 'Visual fallback staging must live in private schema.');
assert.match(sql, /leaflet_offer_region/, 'Staging must explicitly distinguish leaflet offer-region fallbacks.');
assert.match(sql, /verified_product_photo/, 'Staging must reserve a separate verified product-photo source kind.');
assert.match(sql, /status\s+text\s+not null default 'pending'/, 'Fallbacks must require explicit QA state.');
assert.match(sql, /unique \(offer_id, source_kind\)/, 'Only one staged fallback of each source kind may exist per offer.');
assert.match(sql, /revoke all on private\.offer_visual_fallback_candidates from public, anon, authenticated/, 'Fallback staging must not be exposed publicly.');
assert.match(sql, /grant select, insert, update, delete on private\.offer_visual_fallback_candidates to service_role/, 'Only service role may mutate fallback staging.');
assert.doesNotMatch(sql, /grant .* to anon/i, 'Anon must never access fallback staging.');
assert.doesNotMatch(sql, /grant .* to authenticated/i, 'Normal authenticated users must never access fallback staging.');

console.log('offer-visual-fallback-staging: ok');
