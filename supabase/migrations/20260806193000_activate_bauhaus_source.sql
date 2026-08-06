-- Replace obsolete BAUHAUS leaflet URLs with the official catalog overview.
update public.leaflet_sources as source
set
  source_name = 'BAUHAUS – aktuální katalog',
  source_url = 'https://www.bauhaus.cz/katalogy',
  source_type = 'html',
  is_active = true,
  auto_publish = false,
  automation_mode = 'automatic',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'bauhaus'
  and source.source_url = 'https://www.bauhaus.cz/akcni-nabidky';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Nahrazeno funkční oficiální stránkou /katalogy.',
  next_review_at = null,
  last_error = 'Historická adresa /letak neexistuje; používá se oficiální přehled katalogů.',
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'bauhaus'
  and source.source_url <> 'https://www.bauhaus.cz/katalogy';
