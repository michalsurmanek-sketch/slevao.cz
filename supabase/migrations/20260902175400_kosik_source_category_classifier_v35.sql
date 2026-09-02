create or replace function public.infer_product_filter_group_source_category_v35(
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
  if v_store='kosik' then
    if v_root in ('mrazene','trvanlive','mlecne a chlazene','uzeniny a lahudky','pekarna a cukrarna') then
      return 'food';
    end if;
    if v_root='napoje' then return 'drinks'; end if;
    if v_root='drogerie a kosmetika' then return 'drugstore'; end if;
  end if;
  return public.infer_product_filter_group_source_category_v33(p_store_slug,p_category_root,p_category_path);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 35 $function$;

do $do$
declare v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='auto_assign_product_filter_group' limit 1;
  v_sql := replace(v_sql,'infer_product_filter_group_source_category_v33','infer_product_filter_group_source_category_v35');
  v_sql := replace(v_sql,'source-category-v33','source-category-v35');
  execute v_sql;

  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='propagate_structured_product_source_category' limit 1;
  v_sql := replace(v_sql,'infer_product_filter_group_source_category_v33','infer_product_filter_group_source_category_v35');
  v_sql := replace(v_sql,'source-category-v33','source-category-v35');
  execute v_sql;
end
$do$;

with current_kosik as (
  select distinct on (o.product_id)
    o.product_id,
    nullif(trim(o.metadata->>'category'),'') as source_category
  from public.offers o
  join public.stores s on s.id=o.store_id and s.slug='kosik'
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (timezone('Europe/Prague',now()))::date
    and o.valid_to >= (timezone('Europe/Prague',now()))::date
    and nullif(trim(o.metadata->>'category'),'') is not null
  order by o.product_id,o.updated_at desc,o.id
)
update public.products p
set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_category_root',k.source_category,
      'source_category_path',k.source_category,
      'source_category_items',jsonb_build_array(k.source_category),
      'source_category_source','kosik-mainCategory'
    ),
    updated_at=now()
from current_kosik k
where p.id=k.product_id
  and coalesce(p.metadata->>'filter_group_source','') <> 'explicit';