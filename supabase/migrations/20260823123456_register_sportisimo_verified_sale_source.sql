insert into public.leaflet_sources(
  store_id,
  name,
  source_url,
  source_type,
  is_active,
  auto_publish,
  check_interval_minutes,
  coverage_scope,
  automation_mode,
  adapter_key,
  extraction_strategy,
  manual_fallback_enabled,
  updated_at
)
select
  s.id,
  'Sportisimo – oficiální výprodej',
  'https://www.sportisimo.cz/vyprodej/',
  'html',
  true,
  false,
  360,
  'national',
  'dedicated',
  'sportisimo-jina-sale-frontpage-v1',
  'structured_markdown',
  false,
  now()
from public.stores s
where s.slug='sportisimo'
on conflict (source_url) do update
set store_id=excluded.store_id,
    name=excluded.name,
    source_type=excluded.source_type,
    is_active=true,
    auto_publish=false,
    check_interval_minutes=excluded.check_interval_minutes,
    coverage_scope=excluded.coverage_scope,
    automation_mode=excluded.automation_mode,
    disabled_reason=null,
    adapter_key=excluded.adapter_key,
    extraction_strategy=excluded.extraction_strategy,
    manual_fallback_enabled=excluded.manual_fallback_enabled,
    updated_at=now();
