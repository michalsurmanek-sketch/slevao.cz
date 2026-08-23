import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260823141901_archive_and_reclaim_reused_pg_net_request_ids.sql', 'utf8');

assert(sql.includes('private.structured_retail_http_job_history'), 'Reused pg_net job history must be preserved in the private schema.');
assert(sql.includes("archive_reason text not null"), 'Archived jobs must record why they were moved.');
assert(sql.includes("'pg_net_request_id_reused'"), 'Reused request ids must have an explicit archive reason.');
assert(sql.includes("v_old.requested_at >= v_new_requested_at-interval '1 hour'"), 'Fresh request-id collisions must be rejected rather than reclaimed.');
assert(sql.includes('insert into private.structured_retail_http_job_history'), 'Old jobs must be archived before reclaiming the request id.');
assert(sql.includes('delete from public.structured_retail_http_jobs where request_id=v_old.request_id;'), 'Only the stale conflicting tracker row may be removed before insert.');
assert(sql.indexOf('insert into private.structured_retail_http_job_history') < sql.indexOf('delete from public.structured_retail_http_jobs'), 'Archive must happen before deletion.');
assert(sql.includes('security definer') && sql.includes('set search_path = public, private, pg_temp'), 'The reclaim trigger function must use a fixed search path.');
assert(sql.includes('revoke all on function private.reclaim_structured_retail_http_request_id() from public, anon, authenticated;'), 'The reclaim helper must not be externally executable.');
assert(sql.includes('before insert on public.structured_retail_http_jobs'), 'The request-id guard must cover every structured retail HTTP job insert.');

console.log('pg_net request-id reuse guard contract OK');
