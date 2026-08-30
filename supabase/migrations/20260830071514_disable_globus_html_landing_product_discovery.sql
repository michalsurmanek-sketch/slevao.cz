update public.leaflet_import_items lii
set status='ignored',
    raw_data=coalesce(lii.raw_data,'{}'::jsonb)||jsonb_build_object(
      'ignored_reason','globus_html_landing_superseded_by_official_api',
      'ignored_at',now()
    )
where lii.import_id in (
  select li.id
  from public.leaflet_imports li
  join public.leaflet_sources ls on ls.id=li.source_id
  join public.stores s on s.id=li.store_id
  where s.slug='globus'
    and ls.source_url='https://www.globus.cz/olomouc/letaky/aktualni'
    and li.metadata->>'adapter'='store:globus-html'
    and li.status='review'
);

update public.leaflet_imports li
set status='ignored',
    error_message=null,
    finished_at=coalesce(li.finished_at,now()),
    metadata=coalesce(li.metadata,'{}'::jsonb)||jsonb_build_object(
      'ignored_reason','globus_html_landing_superseded_by_official_api',
      'canonical_product_source','globus-action-products-api-v1',
      'ignored_at',now()
    )
from public.leaflet_sources ls, public.stores s
where li.source_id=ls.id
  and li.store_id=s.id
  and s.slug='globus'
  and ls.source_url='https://www.globus.cz/olomouc/letaky/aktualni'
  and li.metadata->>'adapter'='store:globus-html'
  and li.status='review';

update public.leaflet_sources ls
set is_active=false,
    auto_publish=false,
    automation_mode='specialized',
    last_error='HTML landing page není přímý letákový dokument; produktové nabídky vlastní globus-action-products-api-v1.',
    updated_at=now()
from public.stores s
where ls.store_id=s.id
  and s.slug='globus'
  and ls.source_url='https://www.globus.cz/olomouc/letaky/aktualni';
