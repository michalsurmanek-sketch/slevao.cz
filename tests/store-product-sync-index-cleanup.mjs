import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828165710_drop_redundant_store_product_sync_state_store_index.sql', root),
  'utf8',
);

assert.ok(
  /drop\s+index\s+if\s+exists\s+public\.idx_store_product_sync_state_store_id\s*;/i.test(migration),
  'Migration musí odstranit duplicitní store_product_sync_state(store_id) index.',
);
assert.ok(
  !/drop\s+index[^;]*store_product_sync_state_pkey/i.test(migration),
  'Cleanup nesmí odstranit primární klíč store_product_sync_state_pkey.',
);

console.log('Redundant store-product sync-state index cleanup OK');
