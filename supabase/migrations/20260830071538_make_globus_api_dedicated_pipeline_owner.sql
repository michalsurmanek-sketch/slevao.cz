update public.leaflet_sources ls
set automation_mode='specialized',
    auto_publish=true,
    last_error=null,
    updated_at=now()
from public.stores s
where ls.store_id=s.id
  and s.slug='globus'
  and ls.source_url='https://www.globus.cz/olomouc/hypermarket/akcni-nabidka'
  and ls.adapter_key='globus-action-products-api-v1';
