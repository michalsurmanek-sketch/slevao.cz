update public.leaflet_sources ls
set automation_mode='specialized',
    last_error=null,
    updated_at=now()
from public.stores s
where ls.store_id=s.id
  and ls.is_active=true
  and (
    (s.slug='intersport' and ls.adapter_key='intersport-official-sale-html-v1') or
    (s.slug='kosik' and ls.adapter_key='kosik-official-flexible-cursor-v1') or
    (s.slug='pro-doma' and ls.adapter_key='pro-doma-jina-events-v1') or
    (s.slug='tedi' and ls.adapter_key='tedi-home-current-products-v1')
  );
