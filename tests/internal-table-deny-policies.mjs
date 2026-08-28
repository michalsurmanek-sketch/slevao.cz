import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828164124_explicit_deny_policies_for_internal_public_tables.sql', root),
  'utf8',
);

const expectedTables = [
  'albert_offer_staging',
  'albert_product_sync_runs',
  'branch_sync_http_batch',
  'branch_sync_http_state',
  'kaufland_parser_config',
  'kaufland_product_sync_audit',
  'leaflet_basic_parser_runs',
  'leaflet_cold_rebuild_import_backup',
  'leaflet_cold_rebuild_item_backup',
  'leaflet_cold_rebuild_offer_backup',
  'leaflet_cold_rebuild_price_history_backup',
  'leaflet_cold_rebuild_runs',
  'leaflet_extracted_text',
  'leaflet_ocr_pages',
  'leaflet_storage_cleanup_log',
  'offer_bulk_reset_runs',
  'pilulka_catalog_http_state',
  'price_history_quarantine',
  'shopping_list_add_mutations',
  'shopping_purchase_repeat_mutations',
  'structured_retail_http_jobs',
  'web_push_deliveries',
  'web_push_subscriptions',
];

for (const table of expectedTables) {
  assert.ok(migration.includes(`'${table}'`), `Deny-policy migration neobsahuje ${table}.`);
}

assert.equal(
  (migration.match(/'[^']+'/g) || []).filter((value) => expectedTables.includes(value.slice(1, -1))).length,
  expectedTables.length,
  'Deny-policy migration musí uvádět každý interní stůl právě v očekávané sadě.',
);
assert.ok(
  migration.includes("policyname = 'deny_client_access'"),
  'Migration nekontroluje existenci explicitní deny_client_access policy.',
);
assert.ok(
  migration.includes('create policy deny_client_access on public.%I for all to anon, authenticated using (false) with check (false)'),
  'Deny policy musí být fail-closed pro anon/authenticated a nesmí otevřít žádný řádek.',
);
assert.ok(
  !migration.toLowerCase().includes('to public'),
  'Interní deny policy nesmí omylem cílit na PUBLIC a ovlivnit service-role/serverové cesty.',
);

console.log(`Explicit internal-table deny policies OK (${expectedTables.length} tables)`);
await import('./extension-schema-hardening.mjs');
