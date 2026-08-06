-- JIP publikuje tři současné oficiální Flip PDF letáky na nové stránce.
update public.leaflet_sources as source
set
  name = 'JIP – všechny oficiální aktuální letáky',
  source_url = 'https://www.jip-potraviny.cz/akcni-letaky/',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  coverage_scope = 'national',
  automation_mode = 'automatic',
  adapter_key = 'jip-flip-pdf-v1',
  extraction_strategy = 'official_flip_pdf_viewers',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'jip'
  and source.source_url = 'https://www.jip-potraviny.cz/akcni-nabidka';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Nahrazeno funkční oficiální stránkou /akcni-letaky/.',
  next_review_at = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'jip'
  and source.source_url <> 'https://www.jip-potraviny.cz/akcni-letaky/';
