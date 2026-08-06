-- Albert zveřejňuje supermarketové i hypermarketové letáky a katalogy
-- jako úplná PDF v datech své oficiální stránky.
update public.leaflet_sources as source
set
  name = 'Albert – všechny oficiální aktuální letáky',
  source_url = 'https://www.albert.cz/aktualni-letaky',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  coverage_scope = 'national',
  automation_mode = 'automatic',
  adapter_key = 'albert-publitas-v1',
  extraction_strategy = 'official_next_apollo_pdfs',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'albert'
  and source.source_url = 'https://www.albert.cz/aktualni-letaky';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Nahrazeno automatickým importem všech oficiálních publikací Albert.',
  next_review_at = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'albert'
  and source.source_url <> 'https://www.albert.cz/aktualni-letaky';
