update public.leaflet_imports li
set status='ignored',
    metadata=coalesce(li.metadata,'{}'::jsonb) || jsonb_build_object(
      'cleanup_reason','superseded_by_newer_terno_ocr_sync',
      'cleanup_at',now()
    ),
    updated_at=now()
from public.stores s
join public.store_product_sync_state st on st.store_id=s.id
where li.store_id=s.id
  and s.slug='terno'
  and li.status='review'
  and st.health_status='ok'
  and st.last_success_at is not null
  and st.last_success_at>li.updated_at;
