with eligible as (
  select li.id
  from public.leaflet_imports li
  join public.store_product_sync_state st on st.store_id=li.store_id
  where li.status='review'
    and li.updated_at < now()-interval '72 hours'
    and st.health_status='ok'
    and st.last_success_at is not null
    and st.last_success_at > li.updated_at
    and exists (
      select 1
      from public.offers o
      where o.store_id=li.store_id
        and o.status='published'
        and o.valid_from<=current_date
        and o.valid_to>=current_date
    )
)
update public.leaflet_imports li
set status='ignored',
    metadata=coalesce(li.metadata,'{}'::jsonb) || jsonb_build_object(
      'cleanup_reason','superseded_by_newer_healthy_store_sync',
      'cleanup_at',now()
    ),
    updated_at=now()
from eligible e
where li.id=e.id;
