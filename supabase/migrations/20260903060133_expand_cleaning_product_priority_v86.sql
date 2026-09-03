create or replace function public.infer_product_filter_group_generic_terms_v86(p_name text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text:=public.normalize_text(coalesce(p_name,''));
begin
  if n ~ '(prostredek).*(na|pro) (myti )?nadobi'
     or n ~ '(kapsle|tablety).*(do|na) myck'
     or n ~ '(kapsle|tablety).*(na|pro) nadobi'
     or n ~ '(praci prostredek|prostredek na prani|prostredek.*prani)'
     or n ~ 'cistici prostredek.*myck' then
    return 'drugstore';
  end if;
  return public.infer_product_filter_group_generic_terms_v84(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 86 $function$;

do $do$
declare v_def text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  if position('infer_product_filter_group_generic_terms_v85' in v_def)=0 then
    raise exception 'auto classifier no longer references generic v85';
  end if;
  v_def:=replace(v_def,'infer_product_filter_group_generic_terms_v85','infer_product_filter_group_generic_terms_v86');
  v_def:=replace(v_def,'generic-terms-v85','generic-terms-v86');
  execute v_def;
end
$do$;

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
      'filter_group_classifier_checked_version',0,
      'filter_group_requeue_reason','cleaning-product-priority-v86',
      'filter_group_requeued_at',now()
    )
where p.is_active=true
  and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  and public.infer_product_filter_group_generic_terms_v86(p.name,p.quantity_text)='drugstore'
  and coalesce(nullif(btrim(p.filter_group),''),'other')<>'drugstore';
