update public.leaflet_sources ls
set automation_mode='dedicated',
    adapter_key='planeo-official-clearance-v1',
    extraction_strategy='structured_html',
    last_error=null
from public.stores s
where ls.store_id=s.id
  and s.slug='planeo'
  and ls.is_active=true;

update public.leaflet_imports li
set status='ignored',
    error_message='Nahrazen dedikovaným PLANEO structured-products tokem; generic import není produktový owner.',
    finished_at=coalesce(li.finished_at,now()),
    metadata=coalesce(li.metadata,'{}'::jsonb)||jsonb_build_object(
      'archive_reason','superseded_by_planeo_dedicated_pipeline',
      'archived_at',now()
    )
from public.stores s
where li.store_id=s.id
  and s.slug='planeo'
  and li.status in ('review','queued','downloading','processing','publishing')
  and coalesce(li.metadata->>'adapter','generic')='generic';
