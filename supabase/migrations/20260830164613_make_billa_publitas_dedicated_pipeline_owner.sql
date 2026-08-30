update public.leaflet_sources ls
set automation_mode='specialized',
    last_error=null,
    updated_at=now()
from public.stores s
where s.id=ls.store_id
  and s.slug='billa'
  and ls.is_active=true
  and ls.name='BILLA – aktuální letáky';
