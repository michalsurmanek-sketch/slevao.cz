create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 43 $function$;

do $do$
declare
  v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='auto_assign_product_filter_group'
  limit 1;

  v_sql := replace(
    v_sql,
    $$lower(trim(coalesce(v_source_store,'')))='lidl'$$,
    $$lower(trim(coalesce(v_source_store,''))) in ('lidl','hruska')$$
  );
  v_sql := replace(v_sql,'source-page-consensus-v41','source-page-consensus-v43');
  execute v_sql;
end
$do$;

create or replace function private.refresh_hruska_compatible_page_consensus_v43()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_updated integer := 0;
begin
  with current_hruska as (
    select
      o.product_id,
      o.metadata->>'import_id' as import_id,
      (o.metadata->>'leaflet_page')::integer as leaflet_page,
      p.filter_group,
      p.quantity_text
    from public.offers o
    join public.stores st on st.id=o.store_id and st.slug='hruska'
    join public.products p on p.id=o.product_id
    where o.status='published'
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
      and nullif(o.metadata->>'import_id','') is not null
      and o.metadata->>'leaflet_page' ~ '^[0-9]+$'
  ), page_stats as (
    select import_id,leaflet_page,
           count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') known_count,
           count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') group_count,
           min(filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') consensus_group
    from current_hruska
    group by import_id,leaflet_page
    having count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') >= 2
       and count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') = 1
  ), candidates as (
    select distinct p.id,ch.import_id,ch.leaflet_page,ps.consensus_group,ps.known_count
    from current_hruska ch
    join page_stats ps using(import_id,leaflet_page)
    join public.products p on p.id=ch.product_id
    where (p.filter_group is null or btrim(p.filter_group)='')
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
      and (
        (ps.consensus_group='food' and public.normalize_text(coalesce(p.quantity_text,'')) ~ '^[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? (g|kg)$')
        or
        (ps.consensus_group='drinks' and public.normalize_text(coalesce(p.quantity_text,'')) ~ '^[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? (ml|l)$')
      )
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','hruska',
      'source_leaflet_import_id',c.import_id,
      'source_leaflet_page',c.leaflet_page,
      'source_page_consensus_group',c.consensus_group,
      'source_page_consensus_known_count',c.known_count,
      'source_page_consensus_compatibility','food-mass_or_drinks-volume-v43',
      'source_page_consensus_checked_at',now()
  )
  from candidates c
  where p.id=c.id;
  get diagnostics v_updated=row_count;

  return jsonb_build_object('ok',true,'updated',v_updated);
end;
$function$;

revoke all on function private.refresh_hruska_compatible_page_consensus_v43() from public;
grant execute on function private.refresh_hruska_compatible_page_consensus_v43() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='classify-hruska-page-consensus';
select cron.schedule(
  'classify-hruska-page-consensus',
  '17 * * * *',
  $$select private.refresh_hruska_compatible_page_consensus_v43();$$
);

select private.refresh_hruska_compatible_page_consensus_v43();
