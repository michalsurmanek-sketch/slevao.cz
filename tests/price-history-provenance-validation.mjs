import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828171735_backfill_and_validate_price_history_provenance.sql', root),
  'utf8',
).toLowerCase();

assert.ok(
  migration.includes("jsonb_build_object('provenance', 'legacy_backfill_unknown_origin')"),
  'Legacy price-history rows must receive an explicit unknown-origin provenance marker.',
);
assert.ok(
  migration.includes('offer_id is null') && migration.includes("nullif(btrim(source_url), '') is null"),
  'Backfill must only target rows without offer/source provenance.',
);
assert.ok(
  migration.includes("metadata->>'provenance'"),
  'Backfill must preserve rows that already have provenance.',
);
assert.ok(
  migration.includes('validate constraint price_history_direct_insert_provenance'),
  'The provenance constraint must be fully validated after backfill.',
);

console.log('Price history provenance backfill/validation contract OK');
await import('./globus-full-payload-fast-path.mjs');
