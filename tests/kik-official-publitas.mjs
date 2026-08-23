import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/sync-kik-source/index.ts', 'utf8');
const products = fs.readFileSync('supabase/functions/sync-kik-products/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260823192124_restore_kik_official_publitas_pipeline.sql', 'utf8');

assert.match(source, /const VIEWER_ROOT='https:\/\/letaki\.kik\.cz\/'/);
assert.match(source, /const ADAPTER='kik-publitas-v2'/);
assert.match(source, /source_start_until_sold_out_daily_verified_snapshot/);
assert.doesNotMatch(source, /api\.publitas\.com\/v1\/groups/);

assert.match(products, /const SOURCE_ADAPTER = 'kik-publitas-v2'/);
assert.match(products, /const ADAPTER = 'kik-publitas-text-v3'/);
assert.match(products, /timeZone: 'Europe\/Prague'/);
assert.match(products, /valid_to: today/);
assert.match(products, /daily_verified_snapshot_until_replaced/);
assert.match(products, /publication ID se změnilo; nejdřív musí proběhnout source sync/);
assert.match(products, /sha256\(`\$\{publicationId\}\|\$\{row\.article_id\}\|\$\{row\.normalized_title\}`\)/);
assert.doesNotMatch(products, /function addDays\(/);
assert.doesNotMatch(products, /validity_estimated_to_next_cycle/);

assert.match(migration, /check_interval_minutes = case when source_url = 'https:\/\/www\.kik\.cz\/tvuj-online-letak' then 15/);
assert.match(migration, /adapter_key = case when source_url = 'https:\/\/www\.kik\.cz\/tvuj-online-letak' then 'kik-publitas-v2'/);
assert.match(migration, /'slevao-kik-source'/);
assert.match(migration, /'8,23,38,53 \* \* \* \*'/);
assert.match(migration, /'slevao-kik-products'/);
assert.match(migration, /'11,26,41,56 \* \* \* \*'/);
assert.match(migration, /\$cron\$select private\.invoke_edge_function\('sync-kik-source'/);
assert.match(migration, /\$cron\$select private\.invoke_edge_function\('sync-kik-products'/);
assert.doesNotMatch(migration, /\$\$select private\.invoke_edge_function/);

console.log('KiK official Publitas contract is protected.');
