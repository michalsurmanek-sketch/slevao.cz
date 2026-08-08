-- The audit is a run history, so repeated successful checks of the same source
-- signature are valid and expected. A unique partial index on source_signature made
-- every unchanged run fail its final UPDATE and left the audit row stuck as running.

drop index if exists public.idx_kaufland_product_sync_audit_signature;
create index if not exists idx_kaufland_product_sync_audit_signature
  on public.kaufland_product_sync_audit ((metadata ->> 'source_signature'))
  where metadata ? 'source_signature';

-- Rows left running by the old uniqueness conflict can no longer be completed with
-- their original payload. Mark only stale historical rows as failed so monitoring
-- does not treat them as active jobs.
update public.kaufland_product_sync_audit
set status = 'failed',
    error_message = coalesce(error_message, 'Audit zůstal viset kvůli dřívějšímu unikátnímu indexu source_signature.')
where status = 'running'
  and run_at < now() - interval '10 minutes';
