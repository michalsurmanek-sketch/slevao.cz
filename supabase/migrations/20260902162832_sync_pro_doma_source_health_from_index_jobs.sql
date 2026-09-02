create or replace function public.sync_pro_doma_source_health_from_index_job()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if new.adapter='pro-doma-index-v1' and new.status='completed' and new.error_message is null then
    update public.leaflet_sources
       set last_checked_at=coalesce(new.processed_at,now()),
           last_success_at=coalesce(new.processed_at,now()),
           last_error=null,
           last_strategy_used='staged-pro-doma-pg-net-sync',
           last_strategy_success_at=coalesce(new.processed_at,now())
     where store_id=new.store_id
       and is_active=true
       and source_url='https://www.pro-doma.cz/akce';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_pro_doma_source_health_from_index_job on public.structured_retail_http_jobs;
create trigger trg_sync_pro_doma_source_health_from_index_job
after insert or update of status,processed_at,error_message on public.structured_retail_http_jobs
for each row
when (new.adapter='pro-doma-index-v1' and new.status='completed')
execute function public.sync_pro_doma_source_health_from_index_job();

with latest as (
  select j.store_id,max(j.processed_at) as processed_at
  from public.structured_retail_http_jobs j
  join public.stores s on s.id=j.store_id
  where s.slug='pro-doma'
    and j.adapter='pro-doma-index-v1'
    and j.status='completed'
    and j.error_message is null
  group by j.store_id
)
update public.leaflet_sources ls
set last_checked_at=l.processed_at,
    last_success_at=l.processed_at,
    last_error=null,
    last_strategy_used='staged-pro-doma-pg-net-sync',
    last_strategy_success_at=l.processed_at
from latest l
where ls.store_id=l.store_id
  and ls.is_active=true
  and ls.source_url='https://www.pro-doma.cz/akce';
