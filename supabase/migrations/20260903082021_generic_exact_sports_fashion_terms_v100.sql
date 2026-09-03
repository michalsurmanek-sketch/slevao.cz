create or replace function public.infer_product_filter_group_generic_terms_v100(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare n text:=' '||public.normalize_text(coalesce(p_name,''))||' ';
begin
  if n like '% cinka %' or n like '% odporove gumy %' then return 'sports'; end if;
  if n like '% chlapecka sportovni souprava %' or n like '% chlapecka tricka %' or n like '% tricka s dlouhymi rukavy %' then return 'fashion'; end if;
  return public.infer_product_filter_group_generic_terms_v97(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 100 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,'public.infer_product_filter_group_generic_terms_v97(new.name,new.quantity_text)','public.infer_product_filter_group_generic_terms_v100(new.name,new.quantity_text)');
  if v_new=v_def then raise exception 'v100 generic-call patch failed'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'''generic-terms-v97''','''generic-terms-v100''');
  if v_new=v_def then raise exception 'v100 source-label patch failed'; end if;
  execute v_new;
end;
$patch$;

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('reclassify_reason','generic-exact-v100','reclassify_requested_at',now())
where p.is_active=true and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
  and (
    (' '||public.normalize_text(p.name)||' ') like '% cinka %'
    or (' '||public.normalize_text(p.name)||' ') like '% odporove gumy %'
    or (' '||public.normalize_text(p.name)||' ') like '% chlapecka sportovni souprava %'
    or (' '||public.normalize_text(p.name)||' ') like '% chlapecka tricka %'
    or (' '||public.normalize_text(p.name)||' ') like '% tricka s dlouhymi rukavy %'
  );