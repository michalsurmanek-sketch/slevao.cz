create or replace function public.infer_product_filter_group_source_category_v36(
  p_store_slug text,
  p_category_root text,
  p_category_path text
) returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  v_store text := lower(trim(coalesce(p_store_slug,'')));
  v_root text := public.normalize_text(coalesce(p_category_root,''));
begin
  if v_store='globus' then
    if v_root='auto' then return 'auto'; end if;
    if v_root in ('skola','skolni potreby') then return 'school'; end if;
    if v_root='elektronika' then return 'electronics'; end if;
    if v_root='domacnost' then return 'home'; end if;
  end if;
  return public.infer_product_filter_group_source_category_v35(p_store_slug,p_category_root,p_category_path);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 36 $function$;

do $do$
declare v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='auto_assign_product_filter_group' limit 1;
  v_sql := replace(v_sql,'infer_product_filter_group_source_category_v35','infer_product_filter_group_source_category_v36');
  v_sql := replace(v_sql,'source-category-v35','source-category-v36');
  execute v_sql;
end
$do$;

create or replace function private.propagate_globus_unresolved_source_category(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_updated integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Globus rows must be a JSON array.';
  end if;

  with source_rows as (
    select
      item->>'external_id' as external_id,
      nullif(trim(item->'metadata'->>'source_category_root'),'') as category_root,
      nullif(trim(item->'metadata'->>'source_category_path'),'') as category_path,
      item->'metadata'->'source_category_items' as category_items,
      nullif(trim(item->'metadata'->>'source_category_source'),'') as category_source
    from jsonb_array_elements(p_rows) item
    where nullif(trim(item->>'external_id'),'') is not null
      and nullif(trim(item->'metadata'->>'source_category_root'),'') is not null
      and nullif(trim(item->'metadata'->>'source_category_path'),'') is not null
      and jsonb_typeof(item->'metadata'->'source_category_items')='array'
      and nullif(trim(item->'metadata'->>'source_category_source'),'') is not null
  ), prepared as (
    select s.*,
           public.infer_product_filter_group_source_category_v36('globus',s.category_root,s.category_path) as inferred_group
    from source_rows s
  )
  update public.products p
     set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
           'source_category_root',s.category_root,
           'source_category_path',s.category_path,
           'source_category_items',s.category_items,
           'source_category_source',s.category_source
         ),
         classification_source = case when s.inferred_group <> 'other' then 'source-category-v36' else p.classification_source end,
         updated_at = now()
    from prepared s
   where lower(coalesce(p.metadata->>'source_store_slug',''))='globus'
     and coalesce(p.metadata->>'structured_identity_key',p.metadata->>'structured_external_id','')=s.external_id
     and (p.filter_group is null or btrim(p.filter_group)='')
     and coalesce(p.metadata->>'filter_group_source','') <> 'explicit'
     and s.inferred_group <> 'other';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;

create or replace function public.propagate_globus_source_categories(p_rows jsonb)
returns integer
language sql
security definer
set search_path to 'public','private','pg_temp'
as $function$
  select private.propagate_globus_unresolved_source_category(p_rows)
$function$;

revoke all on function public.propagate_globus_source_categories(jsonb) from public;
grant execute on function public.propagate_globus_source_categories(jsonb) to service_role;