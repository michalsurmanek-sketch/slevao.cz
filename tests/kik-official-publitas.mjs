import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/sync-kik-source/index.ts', 'utf8');
const products = fs.readFileSync('supabase/functions/sync-kik-products/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260823192124_restore_kik_official_publitas_pipeline.sql', 'utf8');
const churnGuard = fs.readFileSync('supabase/migrations/20260825212241_kik_ignore_technical_signature_churn.sql', 'utf8');
const canonicalGuard = fs.readFileSync('supabase/migrations/20260825212534_kik_content_guard_canonical_title.sql', 'utf8');

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

assert.match(churnGuard, /p_store_slug='kik' and p_adapter='kik-publitas-text-v3'/);
assert.match(churnGuard, /private\.kik_structured_rows_match_published_set\(p_rows,v_store_id,p_adapter,v_input_count\)/);
assert.match(churnGuard, /'no_changes',true/);
assert.match(churnGuard, /'technical_signature_ignored',true/);
assert.match(churnGuard, /revoke all on function private\.kik_structured_rows_match_published_set/);
assert.doesNotMatch(churnGuard, /p_store_slug='[^']+' and p_adapter='(?!kik-publitas-text-v3)/);

assert.match(canonicalGuard, /public\.normalize_product_name\(trim\(coalesce\(x->>'title',''\)\)\)/);
assert.match(canonicalGuard, /o\.external_id=e\.external_id/);
assert.match(canonicalGuard, /o\.title=e\.title/);
assert.match(canonicalGuard, /o\.normalized_title=e\.normalized_title/);
assert.match(canonicalGuard, /o\.price=e\.price/);
assert.match(canonicalGuard, /o\.valid_from=e\.valid_from/);
assert.match(canonicalGuard, /o\.valid_to=e\.valid_to/);
assert.match(canonicalGuard, /o\.source_url IS NOT DISTINCT FROM e\.source_url/i);
assert.match(canonicalGuard, /o\.confidence_score=e\.confidence/);

console.log('KiK official Publitas and idempotence contracts are protected.');
