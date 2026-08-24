import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260824152925_retry_transient_pro_doma_fetches.sql', 'utf8');

assert(migration.includes('create or replace function public.reconcile_pro_doma_index_sync()'), 'Index reconciler must be replaced by the retry-hardened version.');
assert(migration.includes('create or replace function public.reconcile_pro_doma_detail_sync()'), 'Detail reconciler must be replaced by the retry-hardened version.');
assert((migration.match(/v_retry_count < 2/g) || []).length >= 4, 'Index/detail timeout and HTTP paths must each retain the bounded two-retry limit.');
assert(migration.includes("coalesce(r.status_code,0) in (0,408,425,429)"), 'Index retry must cover the approved transient HTTP status set.');
assert(migration.includes("coalesce(v_http.status_code,0) in (0,408,425,429)"), 'Detail retry must cover the approved transient HTTP status set.');
assert(migration.includes('coalesce(r.status_code,0) between 500 and 599'), 'Index retry must cover transient 5xx responses.');
assert(migration.includes('coalesce(v_http.status_code,0) between 500 and 599'), 'Detail retry must cover transient 5xx responses.');
assert(migration.includes("coalesce(r.status_code,0)=200 and length(coalesce(r.content,''))<5000"), 'Short HTTP-200 index wrappers must be treated as transient.');
assert(migration.includes("coalesce(v_http.status_code,0)=200 and length(coalesce(v_http.content,''))<4000"), 'Short HTTP-200 detail wrappers must be treated as transient.');
assert(migration.includes("'superseded_by',v_req"), 'Failed attempts must retain an auditable superseded_by link.');
assert(migration.includes("'retry_scheduled',true"), 'Superseded attempts must record that a retry was scheduled.');
assert(migration.includes("'parent_request_id',j.request_id"), 'Index retries must retain parent request lineage.');
assert(migration.includes("'parent_request_id',d.request_id"), 'Detail retries must retain parent request lineage.');
assert(migration.includes("'retry_root_request_id'"), 'Retry chains must preserve a stable root request identifier.');
assert((migration.match(/coalesce\(metadata->>'superseded_by',''\)=''/g) || []).length >= 3, 'Superseded attempts must be excluded from active/failure/publication decisions.');
assert(migration.includes("health_status='running'"), 'A scheduled retry must keep operational health in running state.');
assert(migration.includes('last_error=null,last_parser_error=null'), 'Transient retries must not expose a terminal error before exhaustion.');
assert(migration.includes('PRO-DOMA run neúplný po retry:'), 'The run must fail closed after retries are exhausted.');
assert(migration.includes('předchozí nabídky zachovány'), 'Terminal retry exhaustion must preserve the previous verified snapshot.');
assert(migration.includes("publish_structured_store_offers("), 'Retry hardening must retain the verified structured publisher.');
assert(migration.includes("'pro-doma','pro-doma-jina-events-v1'"), 'Retry hardening must not change the PRO-DOMA publisher/parser identity.');
assert(migration.includes('if coalesce(v_count,0)<5 then'), 'The minimum safe product-count guard must remain fail-closed.');
assert(migration.includes("set search_path to 'public', 'net', 'pg_temp'"), 'SECURITY DEFINER functions must retain a fixed search_path.');
assert(migration.includes("url := 'https://r.jina.ai/' || v_fetch_url"), 'Index retries must continue through the official assets-mirror fetch target.');
assert(migration.includes("url := 'https://r.jina.ai/' || (d.metadata->>'event_url')"), 'Detail retries must refetch the same canonical event URL.');

console.log('PRO-DOMA transient retry contract OK');
