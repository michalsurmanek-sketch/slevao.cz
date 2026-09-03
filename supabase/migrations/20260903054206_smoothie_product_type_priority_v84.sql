create or replace function public.infer_product_filter_group_generic_terms_v84(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text:=public.normalize_text(coalesce(p_name,''));
  q text:=lower(btrim(coalesce(p_quantity_text,'')));
begin
  if n ~ '(^| )smoothie( |$)'
     and n !~ '(^| )(mixer|kapsicka|kousky|bowl|miska)( |$)'
     and (
       q ~ '^[0-9]+([,.][0-9]+)?[[:space:]]*(ml|l)$'
       or q ~ '^(1[8-9][0-9]|2[0-9][0-9]|3[0-5][0-9])[[:space:]]*g$'
     ) then return 'drinks'; end if;
  return public.infer_product_filter_group_generic_terms_v81(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 84 $function$;

do $patch_classifier$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,
    'public.infer_product_filter_group_generic_terms_v81(new.name,new.quantity_text)',
    'public.infer_product_filter_group_generic_terms_v84(new.name,new.quantity_text)');
  if v_new=v_def then raise exception 'v84 classifier patch failed at generic inference'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'generic-terms-v81','generic-terms-v84');
  if v_new=v_def then raise exception 'v84 classifier patch failed at source label'; end if;
  execute v_new;
end;
$patch_classifier$;

update public.products p
set updated_at=now()
where p.is_active=true
  and p.metadata->>'filter_group_source'='auto_classifier'
  and public.normalize_text(p.name) ~ '(^| )smoothie( |$)'
  and public.normalize_text(p.name) !~ '(^| )(mixer|kapsicka|kousky|bowl|miska)( |$)'
  and (
    lower(btrim(coalesce(p.quantity_text,''))) ~ '^[0-9]+([,.][0-9]+)?[[:space:]]*(ml|l)$'
    or lower(btrim(coalesce(p.quantity_text,''))) ~ '^(1[8-9][0-9]|2[0-9][0-9]|3[0-5][0-9])[[:space:]]*g$'
  );