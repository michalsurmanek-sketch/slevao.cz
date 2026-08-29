update public.leaflet_sources ls
set automation_mode='specialized',
    auto_publish=false,
    last_error=null,
    updated_at=now()
from public.stores s
where s.id=ls.store_id
  and s.slug='zabka'
  and ls.source_url='https://izabka.cz/';

update public.leaflet_imports li
set status='ignored',
    metadata=coalesce(li.metadata,'{}'::jsonb) || jsonb_build_object(
      'cleanup_reason','superseded_by_zabka_specialized_sync',
      'cleanup_at',now()
    ),
    updated_at=now()
where li.status='review'
  and coalesce(li.metadata->>'adapter','')='generic'
  and exists (
    select 1
    from public.leaflet_sources ls
    join public.stores s on s.id=ls.store_id
    where ls.id=li.source_id
      and s.slug='zabka'
      and ls.source_url='https://izabka.cz/'
  );
