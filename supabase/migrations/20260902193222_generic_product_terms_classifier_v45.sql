create or replace function public.infer_product_filter_group_generic_terms_v45(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if n ~ '(asijske omacky|instantni polevka|hotova jidla|precliky|slehacka|palacinky|linecke rohlicky|mini topinky|penove pusinky|oplatkove trubicky|sardinela|sproty|krehke platky|divoke brusinky|tvarohovy)' then return 'food'; end if;
  if n ~ '(power spray|osetrujici krem proti akne)' then return 'drugstore'; end if;
  if n ~ '(zweigeltrebe|pozdni sber)' then return 'drinks'; end if;
  return public.infer_product_filter_group_generic_terms_v44(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 45 $function$;

do $do$
declare
  v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='auto_assign_product_filter_group'
  limit 1;
  v_sql := replace(v_sql,'infer_product_filter_group_generic_terms_v44','infer_product_filter_group_generic_terms_v45');
  v_sql := replace(v_sql,'generic-terms-v44','generic-terms-v45');
  execute v_sql;
end
$do$;
