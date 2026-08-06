-- KiK publikuje český leták v oficiálním Publitas prohlížeči.
update public.leaflet_sources as source
set
  name = 'KiK – aktuální oficiální leták',
  source_url = 'https://www.kik.cz/tvuj-online-letak',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  coverage_scope = 'national',
  automation_mode = 'automatic',
  adapter_key = 'kik-publitas-v1',
  extraction_strategy = 'official_publitas_pdf',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'kik'
  and source.source_url = 'https://www.kik.cz/prospekt';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Nahrazeno funkční oficiální stránkou Tvůj online leták.',
  next_review_at = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'kik'
  and source.source_url <> 'https://www.kik.cz/tvuj-online-letak';
