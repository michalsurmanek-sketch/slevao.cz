-- Globus product API and leaflet discovery must have independent health/check clocks.
-- Sharing one leaflet_sources row let the product sync continually postpone document discovery.

insert into public.leaflet_sources (
  store_id,
  name,
  source_url,
  source_type,
  is_active,
  auto_publish,
  check_interval_minutes,
  coverage_scope,
  city_name,
  store_location_name,
  automation_mode,
  adapter_key,
  extraction_strategy,
  manual_fallback_enabled,
  last_checked_at,
  last_success_at,
  last_error
)
select s.id,
       'Globus Olomouc – aktuální leták',
       'https://www.globus.cz/olomouc/letaky/aktualni',
       'html',
       true,
       true,
       180,
       'city',
       'Olomouc',
       'Olomouc',
       'automatic',
       'globus-leaflet-document-v1',
       'html_document',
       true,
       null,
       null,
       null
from public.stores s
where s.slug = 'globus'
on conflict (source_url) do update
set store_id = excluded.store_id,
    name = excluded.name,
    source_type = excluded.source_type,
    is_active = true,
    auto_publish = true,
    check_interval_minutes = excluded.check_interval_minutes,
    coverage_scope = excluded.coverage_scope,
    city_name = excluded.city_name,
    store_location_name = excluded.store_location_name,
    automation_mode = excluded.automation_mode,
    adapter_key = excluded.adapter_key,
    extraction_strategy = excluded.extraction_strategy,
    manual_fallback_enabled = true,
    last_checked_at = null,
    last_error = null,
    updated_at = now();
