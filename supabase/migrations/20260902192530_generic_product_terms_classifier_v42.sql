create or replace function public.infer_product_filter_group_generic_terms_v42(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
  q text := public.normalize_text(coalesce(p_quantity_text,''));
begin
  if n ~ '(bruschetta|100 pyre|ovocna kasicka|edamame)' then return 'food'; end if;
  if n ~ '(primitivo|rulandske|muskat moravsky)' then return 'drinks'; end if;
  if n ~ 'venecky' and q ~ '^[0-9]+([,.][0-9]+)? g$' then return 'food'; end if;
  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 42 $function$;

do $do$
declare
  v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='auto_assign_product_filter_group'
  limit 1;

  if position('infer_product_filter_group_generic_terms_v42' in v_sql)=0 then
    v_sql := replace(
      v_sql,
      $$if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;$$,
      $$if v_inferred='other' then v_inferred := public.infer_product_filter_group_generic_terms_v42(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;$$
    );
    v_sql := replace(
      v_sql,
      $$elsif public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata) <> 'other' then new.classification_source := 'gap-rules-v34';$$,
      $$elsif public.infer_product_filter_group_generic_terms_v42(new.name,new.quantity_text) <> 'other' then new.classification_source := 'generic-terms-v42';
      elsif public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata) <> 'other' then new.classification_source := 'gap-rules-v34';$$
    );
    execute v_sql;
  end if;
end
$do$;
