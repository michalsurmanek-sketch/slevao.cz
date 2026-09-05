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

assert.match(products, /const SOURCE_ADAPTER\s*=\s*'kik-publitas-v2'/);
assert.match(products, /const ADAPTER\s*=\s*'kik-publitas-article-anchor-v4'/);
assert.match(products, /const PARSER\s*=\s*'kik-publitas-article-anchor-v4'/);
assert.match(products, /const KIK_API\s*=\s*'https:\/\/api-shop\.prod\.kik\.de\/api\/v1\/products'/);
assert.match(products, /const MIN_SAFE\s*=\s*30/);
assert.match(products, /const MAX_SAFE\s*=\s*120/);
assert.match(products, /timeZone:\s*'Europe\/Prague'/);
assert.match(products, /async function buildRows\(/);
assert.match(products, /hit\.origin_exact/);
assert.match(products, /distinctPrices\.length !== 1/);
assert.match(products, /official_image_source:\s*'media\.kik\.de'/);
assert.match(products, /row\.external_id\s*=\s*`kik:article:\$\{row\.article_id\}`/);
assert.match(products, /valid_to:\s*today/);
assert.match(products, /daily_verified_snapshot_until_replaced/);
assert.match(products, /publication ID se změnilo; nejdřív musí proběhnout source sync/);
assert.match(products, /built\.rows\.length < MIN_SAFE \|\| built\.rows\.length > MAX_SAFE/);
assert.match(products, /let dryRun\s*=\s*true/);
assert.match(products, /dryRun\s*=\s*body\.dry_run !== false/);
assert.match(products, /if \(dryRun\) return json/);
assert.match(products, /state\?\.last_source_signature === signature/);
assert.match(products, /\.eq\('metadata->>adapter', ADAPTER\)/);
assert.match(products, /\(count \|\| 0\) >= MIN_SAFE/);
assert.match(products, /db\.rpc\('publish_structured_store_offers'/);
assert.match(products, /p_store_slug:\s*'kik'/);
assert.match(products, /p_adapter:\s*ADAPTER/);
assert.match(products, /p_min_products:\s*MIN_SAFE/);
assert.match(products, /p_max_products:\s*MAX_SAFE/);
assert.match(products, /p_source_document_url:\s*viewer/);
assert.match(products, /p_parser_version:\s*PARSER/);
assert.match(products, /health_reason:\s*'Nová KiK sada nebyla publikována; předchozí veřejná data zůstala beze změny\.'/);
assert.doesNotMatch(products, /function addDays\(/);
assert.doesNotMatch(products, /validity_estimated_to_next_cycle/);

assert.match(migration, /check_interval_minutes = case when source_url = 'https:\/\/www\.kik\.cz\/tvuj-online-letak' then 15/);
assert.match(migration, /adapter_key = case when source_url = 'https:\/\/www\.kik\.cz\/tvuj-online-letak' then 'kik-publitas-v2'/);
assert.match(migration, /'slevao-kik-source'/);
assert.match(migration, /'8,23,38,53 \* \* \* \*'/);
assert.match(migration, /'slevao-kik-products'/);
assert.match(migration, /'11,26,41,56 \* \* \* \*'/);
assert.match(migration, /invoke_edge_function\('sync-kik-products',jsonb_build_object\('dry_run',false,'force',false\)/);
assert.match(migration, /\$cron\$select private\.invoke_edge_function\('sync-kik-source'/);
assert.match(migration, /\$cron\$select private\.invoke_edge_function\('sync-kik-products'/);
assert.doesNotMatch(migration, /\$\$select private\.invoke_edge_function/);

// Historical v3 guard must stay scoped to the historical adapter so migration replay cannot alter v4 behavior.
assert.match(churnGuard, /p_store_slug='kik' and p_adapter='kik-publitas-text-v3'/);
assert.match(churnGuard, /private\.kik_structured_rows_match_published_set\(p_rows,v_store_id,p_adapter,v_input_count\)/);
assert.match(churnGuard, /'no_changes',true/);
assert.match(churnGuard, /'technical_signature_ignored',true/);
assert.match(churnGuard, /revoke all on function private\.kik_structured_rows_match_published_set/);
assert.doesNotMatch(churnGuard, /kik-publitas-article-anchor-v4/);

assert.match(canonicalGuard, /public\.normalize_product_name\(trim\(coalesce\(x->>'title',''\)\)\)/);
assert.match(canonicalGuard, /o\.external_id=e\.external_id/);
assert.match(canonicalGuard, /o\.title=e\.title/);
assert.match(canonicalGuard, /o\.normalized_title=e\.normalized_title/);
assert.match(canonicalGuard, /o\.price=e\.price/);
assert.match(canonicalGuard, /o\.valid_from=e\.valid_from/);
assert.match(canonicalGuard, /o\.valid_to=e\.valid_to/);
assert.match(canonicalGuard, /o\.source_url IS NOT DISTINCT FROM e\.source_url/i);
assert.match(canonicalGuard, /o\.confidence_score=e\.confidence/);

console.log('KiK official Publitas article-anchor v4 safety contracts are protected.');
