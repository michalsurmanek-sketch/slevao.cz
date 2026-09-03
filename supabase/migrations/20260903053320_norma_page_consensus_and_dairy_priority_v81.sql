create or replace function public.infer_product_filter_group_generic_terms_v81(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text:=public.normalize_text(coalesce(p_name,''));
  q text:=lower(btrim(coalesce(p_quantity_text,'')));
begin
  if n ~ '(^| )jogurt( |$)'
     and q ~ '^(cca[[:space:]]+)?[0-9]+([,.][0-9]+)?([[:space:]]*[-–][[:space:]]*[0-9]+([,.][0-9]+)?)?[[:space:]]*(g|kg)$' then
    return 'food';
  end if;
  return public.infer_product_filter_group_generic_terms_v66(p_name,p_quantity_text);
end;
$function$;

create or replace function private.refresh_norma_compatible_page_consensus_v81()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_updated integer:=0;
begin
  with current_norma as (
    select o.product_id,o.metadata->>'import_id' import_id,(o.metadata->>'leaflet_page')::integer leaflet_page,
           p.filter_group,p.quantity_text
    from public.offers o
    join public.stores st on st.id=o.store_id and st.slug='norma'
    join public.products p on p.id=o.product_id
    where o.status='published' and o.is_verified=true
      and o.valid_from <= (now() at time zone 'Europe/Prague')::date
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
      and nullif(o.metadata->>'import_id','') is not null
      and o.metadata->>'leaflet_page' ~ '^[0-9]+$'
  ), page_stats as (
    select import_id,leaflet_page,
           count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') known_count,
           count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') group_count,
           min(filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') consensus_group
    from current_norma
    group by import_id,leaflet_page
    having count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') >= 3
       and count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') = 1
  ), candidates as (
    select distinct p.id,cn.import_id,cn.leaflet_page,ps.consensus_group,ps.known_count
    from current_norma cn
    join page_stats ps using(import_id,leaflet_page)
    join public.products p on p.id=cn.product_id
    where coalesce(nullif(btrim(p.filter_group),''),'other')='other'
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
      and (
        (ps.consensus_group='food' and lower(btrim(coalesce(p.quantity_text,''))) ~ '^(cca[[:space:]]+)?[0-9]+([,.][0-9]+)?([[:space:]]*[-–][[:space:]]*[0-9]+([,.][0-9]+)?)?[[:space:]]*(g|kg)$')
        or
        (ps.consensus_group='drinks' and lower(btrim(coalesce(p.quantity_text,''))) ~ '^(cca[[:space:]]+)?[0-9]+([,.][0-9]+)?([[:space:]]*[-–][[:space:]]*[0-9]+([,.][0-9]+)?)?[[:space:]]*(ml|l)$')
      )
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','norma',
      'source_leaflet_import_id',c.import_id,
      'source_leaflet_page',c.leaflet_page,
      'source_page_consensus_group',c.consensus_group,
      'source_page_consensus_known_count',c.known_count,
      'source_page_consensus_compatibility','food-mass_or_drinks-volume-v81',
      'source_page_consensus_checked_at',now()
  )
  from candidates c where p.id=c.id;
  get diagnostics v_updated=row_count;
  return jsonb_build_object('ok',true,'updated',v_updated);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 81 $function$;

do $patch_classifier$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,$q$in ('lidl','hruska','flop','billa','terno')$q$,$q$in ('lidl','hruska','flop','billa','terno','norma')$q$);
  if v_new=v_def then raise exception 'v81 classifier patch failed at page store list'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,$q$when 'terno' then 'source-page-consensus-v66' else 'source-page-consensus-v43'$q$,$q$when 'terno' then 'source-page-consensus-v66' when 'norma' then 'source-page-consensus-v81' else 'source-page-consensus-v43'$q$);
  if v_new=v_def then raise exception 'v81 classifier patch failed at page source mapping'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'public.infer_product_filter_group_generic_terms_v66(new.name,new.quantity_text)','public.infer_product_filter_group_generic_terms_v81(new.name,new.quantity_text)');
  if v_new=v_def then raise exception 'v81 classifier patch failed at generic inference'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'generic-terms-v66','generic-terms-v81');
  if v_new=v_def then raise exception 'v81 classifier patch failed at generic source label'; end if;
  execute v_new;
end;
$patch_classifier$;

select private.refresh_norma_compatible_page_consensus_v81();

update public.products p
set updated_at=now()
where p.is_active=true
  and p.metadata->>'filter_group_source'='auto_classifier'
  and p.filter_group='drinks'
  and public.normalize_text(p.name) ~ '(^| )jogurt( |$)';

do $schedule$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='classify-norma-page-consensus' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('classify-norma-page-consensus','23 * * * *','select private.refresh_norma_compatible_page_consensus_v81();');
end;
$schedule$;