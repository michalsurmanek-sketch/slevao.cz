with latest_published as (
  select distinct on (li.store_id)
         li.store_id,
         li.id,
         li.created_at
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  where s.slug in ('dm','rossmann')
    and li.status='published'
  order by li.store_id, li.created_at desc
), superseded as (
  select li.id
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  join latest_published lp on lp.store_id=li.store_id
  where s.slug in ('dm','rossmann')
    and li.id<>lp.id
    and li.status in ('review','queued','downloading','processing','publishing')
    and li.created_at <= lp.created_at
)
update public.leaflet_imports li
set status='ignored',
    error_message='Nahrazen novějším publikovaným průběžným snapshotem.',
    finished_at=coalesce(li.finished_at,now()),
    metadata=coalesce(li.metadata,'{}'::jsonb)||jsonb_build_object(
      'archive_reason','superseded_continuous_snapshot',
      'archived_at',now()
    )
from superseded s
where li.id=s.id;
