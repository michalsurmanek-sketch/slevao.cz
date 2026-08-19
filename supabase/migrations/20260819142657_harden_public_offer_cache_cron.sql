do $guard$
declare
  v_job_id bigint;
  v_populated boolean;
begin
  select c.relispopulated into v_populated
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private'
    and c.relname='public_offer_search_cache'
    and c.relkind='m';

  if coalesce(v_populated,false) and exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid=i.indexrelid
    join pg_class tbl on tbl.oid=i.indrelid
    join pg_namespace n on n.oid=tbl.relnamespace
    where n.nspname='private'
      and tbl.relname='public_offer_search_cache'
      and idx.relname='public_offer_search_cache_offer_id_uidx'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indpred is null
  ) then
    select jobid into v_job_id
    from cron.job
    where jobname='refresh-public-offer-search-cache'
    order by jobid
    limit 1;

    if v_job_id is not null then
      perform cron.alter_job(
        job_id := v_job_id,
        command := 'REFRESH MATERIALIZED VIEW CONCURRENTLY private.public_offer_search_cache'
      );
    end if;
  end if;

  if to_regclass('public.public_offer_search_cache_v2') is null
     and exists (select 1 from cron.job where jobname='refresh-public-offer-search-cache-v2') then
    perform cron.unschedule('refresh-public-offer-search-cache-v2');
  end if;
end
$guard$;
