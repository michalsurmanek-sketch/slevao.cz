create or replace function public.infer_product_filter_group_generic_terms_v97(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare n text:=public.normalize_text(coalesce(p_name,''));
begin
  if n ~ '(instantni kakaovy napoj|kakaovy napoj|instantni napoj)' then return 'drinks'; end if;
  return public.infer_product_filter_group_generic_terms_v94(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 97 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,'public.infer_product_filter_group_generic_terms_v94(new.name,new.quantity_text)','public.infer_product_filter_group_generic_terms_v97(new.name,new.quantity_text)');
  if v_new=v_def then raise exception 'v97 generic-call patch failed'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'''generic-terms-v94''','''generic-terms-v97''');
  if v_new=v_def then raise exception 'v97 source-label patch failed'; end if;
  execute v_new;
end;
$patch$;