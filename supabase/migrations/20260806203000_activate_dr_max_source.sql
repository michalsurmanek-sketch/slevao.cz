-- Dr. Max publikuje aktuální leták ve vlastním Triobo kiosku.
update public.leaflet_sources as source
set
  name = 'Dr. Max – aktuální oficiální leták',
  source_url = 'https://maximum.drmax.cz/letak',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  coverage_scope = 'national',
  automation_mode = 'automatic',
  adapter_key = 'drmax-triobo-v1',
  extraction_strategy = 'official_viewer',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'dr-max'
  and source.source_url = 'https://www.drmax.cz/letak';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Nahrazeno funkčním oficiálním Triobo kioskem Dr. Max.',
  next_review_at = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'dr-max'
  and source.source_url <> 'https://maximum.drmax.cz/letak';
