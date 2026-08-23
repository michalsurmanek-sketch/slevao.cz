update public.leaflet_sources ls
set automation_mode='dedicated',
    adapter_key='stavmat-official-promo-html-v1',
    extraction_strategy='structured_html',
    last_error=null
from public.stores s
where ls.store_id=s.id
  and s.slug='stavmat'
  and ls.is_active=true
  and ls.name='STAVMAT aktuální akční nabídka';

update public.leaflet_imports li
set status='ignored',
    error_message='Nahrazen dedikovaným STAVMAT homepage→promo→structured-products tokem; generic PDF není produktový owner.',
    finished_at=coalesce(li.finished_at,now()),
    metadata=coalesce(li.metadata,'{}'::jsonb)||jsonb_build_object(
      'archive_reason','superseded_by_stavmat_dedicated_pipeline',
      'archived_at',now()
    )
from public.stores s
where li.store_id=s.id
  and s.slug='stavmat'
  and li.status in ('review','queued','downloading','processing','publishing')
  and coalesce(li.metadata->>'adapter','generic')='generic';
