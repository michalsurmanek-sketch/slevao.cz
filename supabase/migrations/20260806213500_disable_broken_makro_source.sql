-- Původní URL katalogu Makro už nevrací katalog ani akční produkty.
-- Přesměruje do nové klientské aplikace bez veřejně dostupných letákových dat,
-- proto generický import končil opakovanou chybou a nesmí zůstávat aktivní.

update public.leaflet_sources ls
set is_active = false,
    last_checked_at = now(),
    last_error = 'Původní katalogová URL přesměruje do nové aplikace bez strojově dostupných letákových dat; zdroj byl vypnut.',
    updated_at = now()
from public.stores s
where ls.store_id = s.id
  and s.slug = 'makro'
  and ls.is_active = true;
