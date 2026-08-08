-- run-leaflet-pipeline-v2 verifies product-backed sources by store_id. The status
-- view omitted that field, so the Edge Function built REST filters `store_id=eq.`
-- and PostgreSQL rejected the empty value as an invalid UUID.

create or replace view public.leaflet_source_pipeline_status as
select
  ls.id as source_id,
  ls.store_id,
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
