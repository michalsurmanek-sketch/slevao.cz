-- OBI's current Czech leaflet is exposed through its official Bonial widget.
-- Keep only the canonical working page active; the historical /letak URL is 404.
update public.leaflet_sources as source
set
  is_active = true,
  auto_publish = false,
  automation_mode = 'automatic',
  disabled_reason = null,
  next_review_at = null,
  last_error = null,
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'obi'
  and source.source_url = 'https://www.obi.cz/nabidky/aktualni-letak';

update public.leaflet_sources as source
set
  is_active = false,
  automation_mode = 'paused',
  disabled_reason = 'Nahrazeno funkční oficiální stránkou /nabidky/aktualni-letak.',
  next_review_at = null,
  last_error = 'Historická adresa /letak neexistuje; používá se oficiální Bonial widget.',
  updated_at = now()
from public.stores as store
where source.store_id = store.id
  and store.slug = 'obi'
  and source.source_url <> 'https://www.obi.cz/nabidky/aktualni-letak';
