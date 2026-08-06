-- Kaufland zveřejňuje aktuální letáky přímo jako strukturované PDF karty.
update public.leaflet_sources as source
set
  name = 'Kaufland – oficiální aktuální letáky',
  source_url = 'https://prodejny.kaufland.cz/letak.html',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  coverage_scope = 'national',
  automation_mode = 'automatic',
  adapter_key = 'kaufland-pdf-v1',
  extraction_strategy = 'official_structured_pdfs',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'kaufland'
  and source.source_url = 'https://prodejny.kaufland.cz/letak.html';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Ruční zdroj je nahrazen automatickým oficiálním importem Kaufland.',
  next_review_at = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'kaufland'
  and source.source_url <> 'https://prodejny.kaufland.cz/letak.html';
