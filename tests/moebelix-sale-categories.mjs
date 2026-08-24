import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260823141720_create_moebelix_verified_sale_categories_pipeline.sql', 'utf8');
const retrySql = fs.readFileSync('supabase/migrations/20260823204527_retry_transient_moebelix_sale_categories.sql', 'utf8');

assert(sql.includes('https://r.jina.ai/https://www.moebelix.cz/c/slevy'), 'Möbelix must start from the official SALE index through the verified reader path.');
assert(sql.includes("'X-With-Links-Summary','true'"), 'Möbelix must request link summary for stable product identity.');
assert(sql.includes("p_eyecatcher=[^ )]+"), 'Möbelix must discover current SALE categories dynamically from the official index.');
assert(sql.includes("coalesce(v_category_count,0)<8") && sql.includes('v_category_count>15'), 'Möbelix index fan-out must stay bounded to a safe category range.');
assert(sql.includes("'moebelix:'||product_id"), 'Möbelix external identity must use the official 12-digit product id.');
assert(sql.includes("product_id ~ '^[0-9]{12}$'"), 'Möbelix parser must require a 12-digit product id.');
assert(sql.includes('product_card_count=1'), 'Ambiguous same-id variants must be rejected within each category page.');
assert(sql.includes('[[:space:]]*‒[[:space:]]*Kč'), 'Price parsing must tolerate line breaks without relaxing numeric validation.');
assert(sql.includes("image_url like 'https://media.moebelix.com/%'"), 'Only official Möbelix image URLs may be published.');
assert(sql.includes('count(distinct price) as price_versions'), 'Cross-category product duplicates must be checked for price conflicts.');
assert(sql.includes('count(distinct old_price) as old_price_versions'), 'Cross-category product duplicates must be checked for original-price conflicts.');
assert(sql.includes('count(distinct source_url) as url_versions'), 'Cross-category product duplicates must be checked for URL conflicts.');
assert(sql.includes("coalesce(v_count,0)<60") && sql.includes("coalesce(v_count,0)>250"), 'Möbelix publication must remain fail-closed to 60–250 verified products.');
assert(sql.includes("now() at time zone 'Europe/Prague'"), 'Daily validity must use the Czech business date.');
assert(sql.includes("'validity_policy','daily_verified_snapshot'"), 'Möbelix offers must explicitly use daily verified validity.');
assert(sql.includes("'all_sale_categories_strict_identity'"), 'Möbelix coverage must state that all discovered SALE categories are processed with strict identity.');
assert(sql.includes("'dedicated','moebelix-jina-sale-categories-v1','structured_markdown'"), 'The source must be owned by the dedicated Möbelix adapter.');
assert(sql.includes('manual_fallback_enabled=false'), 'Möbelix must not silently fall back to manual/unsafe extraction.');
assert(sql.includes('revoke all on function public.trigger_moebelix_verified_sync() from public, anon, authenticated;'), 'Möbelix trigger must not be public.');
assert(sql.includes('revoke all on function public.reconcile_moebelix_verified_sync() from public, anon, authenticated;'), 'Möbelix reconciler must not be public.');
assert(sql.includes("cron.schedule('sync-moebelix-verified-products','29 */6 * * *'"), 'Möbelix verified sync must run every six hours.');
assert(sql.includes("cron.schedule('reconcile-moebelix-verified-products','2-57/5 * * * *'"), 'Möbelix reconciler must process queued requests every five minutes.');

assert(retrySql.includes("'retry_count',0"), 'Every initial Möbelix category request must start with retry_count=0.');
assert(retrySql.includes('v_retry<2'), 'Transient Möbelix category failures may be retried at most twice.');
assert(retrySql.includes("coalesce(j.metadata->>'source_url','') like 'https://www.moebelix.cz/%'"), 'Retries must stay restricted to official Möbelix URLs.');
assert(retrySql.includes("'retry_of_request_id',j.request_id"), 'Retry jobs must preserve the failed request lineage.');
assert(retrySql.includes("'retry_scheduled',true"), 'A failed attempt must remain auditable when a retry is scheduled.');
assert(retrySql.includes("'retry_exhausted',true"), 'Exhausted retries must be recorded explicitly.');
assert(retrySql.includes("select distinct on (c.metadata->>'source_url')"), 'Run completeness must be based on one latest attempt per category URL.');
assert(retrySql.includes("coalesce((c.metadata->>'retry_count')::int,0) desc"), 'The latest retry attempt must outrank older category attempts.');
assert(retrySql.includes('with latest_jobs as'), 'Publication input must use latest category attempts only.');
assert(retrySql.includes("coalesce(v_count,0)<60") && retrySql.includes("coalesce(v_count,0)>250"), 'Retry hardening must preserve the 60–250 fail-closed offer guard.');
assert(retrySql.includes("now() at time zone 'Europe/Prague'"), 'Retry hardening must preserve Czech business-date validity.');

console.log('Möbelix verified SALE categories and retry contract OK');
