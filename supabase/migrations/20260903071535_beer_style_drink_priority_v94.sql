create or replace function public.infer_product_filter_group_generic_terms_v94(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare n text:=public.normalize_text(coalesce(p_name,'')); q text:=public.normalize_text(coalesce(p_quantity_text,''));
begin
  if n ~ '(ryze horka|temne horka)' and q ~ '(ml|l)$' then return 'drinks'; end if;
  return public.infer_product_filter_group_generic_terms_v86(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 94 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,'public.infer_product_filter_group_generic_terms_v86(new.name,new.quantity_text)','public.infer_product_filter_group_generic_terms_v94(new.name,new.quantity_text)');
  if v_new=v_def then raise exception 'v94 generic-call patch failed'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'''generic-terms-v86''','''generic-terms-v94''');
  if v_new=v_def then raise exception 'v94 source-label patch failed'; end if;
  execute v_new;
end;
$patch$;

-- Requeue only legacy auto/name-token beer-style identities; metadata update fires the classifier trigger.
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('reclassify_reason','beer-style-v94','reclassify_requested_at',now())
where p.is_active=true
  and p.filter_group='food'
  and coalesce(p.classification_source,'')='name-token-v5'
  and public.normalize_text(p.name) ~ '(ryze horka|temne horka)'
  and public.normalize_text(coalesce(p.quantity_text,'')) ~ '(ml|l)$';