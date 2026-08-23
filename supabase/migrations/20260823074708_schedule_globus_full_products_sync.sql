do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname='slevao-globus-products' loop
    perform cron.unschedule(v_job);
  end loop;
end $$;

select cron.schedule(
  'slevao-globus-products',
  '12,42 * * * *',
  $cron$select private.invoke_edge_function('sync-globus-products', jsonb_build_object('dry_run', false), 120000);$cron$
);

update public.leaflet_sources ls
set name='Globus Olomouc – akční nabídka API',
    source_url='https://www.globus.cz/olomouc/hypermarket/akcni-nabidka',
    source_type='api',
    auto_publish=true,
    check_interval_minutes=525600,
    coverage_scope='city',
    region_code=null,
    city_name='Olomouc',
    store_location_name='Globus Olomouc',
    automation_mode='automatic',
    adapter_key='globus-action-products-api-v1',
    extraction_strategy='structured_api',
    manual_fallback_enabled=false,
    last_error=null,
    updated_at=now()
from public.stores s
where s.id=ls.store_id and s.slug='globus' and ls.is_active=true;

update public.leaflet_imports li
set status='ignored',
    error_message=null,
    metadata=coalesce(li.metadata,'{}'::jsonb) || jsonb_build_object(
      'archive_reason','superseded_by_globus_action_products_api_v1',
      'archived_automatically_at',now()
    ),
    updated_at=now()
from public.stores s
where s.id=li.store_id
  and s.slug='globus'
  and coalesce(li.metadata->>'adapter','')='store:globus-html'
  and li.status in ('queued','downloading','processing','review','publishing');
