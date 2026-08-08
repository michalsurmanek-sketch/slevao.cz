-- Tesco has a dedicated sync path (sync-tesco-current) scheduled every 30 minutes.
-- The generic pipeline v2 still verifies Tesco through legacy leaflet_import rows and
-- therefore reports a false failure after a successful online-cover sync.
-- Keep the underlying source active for the dedicated Tesco job, but expose it as
-- inactive only to the generic pipeline status view used by run-leaflet-pipeline-v2.

create or replace view public.leaflet_source_pipeline_status as
select
  ls.id as source_id,
  s.slug as store_slug,
  s.name as store_name,
  ls.name as source_name,
  (ls.is_active and s.slug <> 'tesco') as is_active,
  ls.automation_mode,
  ls.adapter_key,
  ls.extraction_strategy,
  ls.fallback_order,
  ls.manual_fallback_enabled,
  ls.last_strategy_used,
  ls.last_strategy_success_at,
  ls.last_checked_at,
  ls.last_success_at,
  ls.last_error
from public.leaflet_sources ls
join public.stores s on s.id = ls.store_id;

alter view public.leaflet_source_pipeline_status set (security_invoker = true);
revoke all on table public.leaflet_source_pipeline_status from anon;
grant select on table public.leaflet_source_pipeline_status to authenticated;

-- Remove the legacy verifier's false error. The dedicated Tesco synchronizer writes
-- its own real error if the official Tesco page actually becomes unavailable.
update public.leaflet_sources ls
set last_error = null,
    last_strategy_used = 'dedicated-tesco-online-sync',
    updated_at = now()
from public.stores s
where s.id = ls.store_id
  and s.slug = 'tesco'
  and ls.is_active = true
  and ls.last_error = 'Zdroj tesco po kontrole nemá žádný aktuální import.';
