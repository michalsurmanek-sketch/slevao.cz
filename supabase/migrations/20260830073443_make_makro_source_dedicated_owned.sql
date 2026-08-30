update public.leaflet_sources ls
set automation_mode='specialized',
    last_error=null,
    updated_at=now()
from public.stores s
where ls.store_id=s.id
  and s.slug='makro'
  and ls.is_active=true
  and ls.adapter_key='makro-publitas-source-v1';
