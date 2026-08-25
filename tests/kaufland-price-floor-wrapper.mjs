import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260825193500_filter_kaufland_below_price_floor.sql', 'utf8');
const priceGuard = readFileSync('supabase/migrations/20260808153000_fix_implausible_import_prices.sql', 'utf8');

assert.match(priceGuard, /offers_published_min_price_check[\s\S]*status <> 'published' or price >= 2/i,
  'Global published-offer 2 CZK quality floor must remain intact.');
assert.match(migration, /rename to apply_kaufland_official_offers_unfiltered_v1/i,
  'The proven atomic Kaufland publisher must remain preserved behind the wrapper.');
assert.match(migration, /\(item ->> 'price'\)::numeric >= 2/i,
  'Kaufland wrapper must remove only rows below the global public price floor.');
assert.match(migration, /v_filtered_count < 50/i,
  'Kaufland wrapper must retain an absolute safe batch floor.');
assert.match(migration, /skipped_below_price_floor/i,
  'Filtered Kaufland rows must remain observable in the publisher result.');
assert.match(migration, /revoke all on function public\.apply_kaufland_official_offers_unfiltered_v1[\s\S]*from public, anon, authenticated, service_role/i,
  'Raw unfiltered publisher must not remain callable through API roles.');
assert.match(migration, /grant execute on function public\.apply_kaufland_official_offers\([\s\S]*to service_role/i,
  'Filtered wrapper must remain service-role only.');

console.log('Kaufland official price-floor wrapper remains fail-safe.');
