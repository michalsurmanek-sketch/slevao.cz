create or replace function public.infer_product_filter_group_pure_fashion_store_v90(p_source_store text)
returns text
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$
  select case when lower(trim(coalesce(p_source_store,''))) in ('cropp','reserved','house','takko') then 'fashion' else 'other' end
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 90 $function$;

do $do$
declare v_def text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);

  if position($needle$v_source_category boolean := false; v_kaufland_context boolean := false;$needle$ in v_def)=0 then
    raise exception 'auto classifier declaration block changed';
  end if;
  v_def:=replace(v_def,
    $old$v_source_category boolean := false; v_kaufland_context boolean := false;$old$,
    $new$v_pure_fashion boolean := false; v_source_category boolean := false; v_kaufland_context boolean := false;$new$);

  if position($needle$if v_inferred='other' then v_inferred:=public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path); v_source_category:=v_inferred<>'other'; end if;$needle$ in v_def)=0 then
    raise exception 'source category inference block changed';
  end if;
  v_def:=replace(v_def,
    $old$if v_inferred='other' then v_inferred:=public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path); v_source_category:=v_inferred<>'other'; end if;$old$,
    $new$if v_inferred='other' then v_inferred:=public.infer_product_filter_group_pure_fashion_store_v90(v_source_store); v_pure_fashion:=v_inferred<>'other'; end if;
    if v_inferred='other' then v_inferred:=public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path); v_source_category:=v_inferred<>'other'; end if;$new$);

  if position($needle$new.filter_group:=v_inferred;$needle$ in v_def)=0 then
    raise exception 'filter assignment block changed';
  end if;
  v_def:=replace(v_def,
    $old$new.filter_group:=v_inferred;$old$,
    $new$new.filter_group:=v_inferred;
      if v_pure_fashion then
        if new.category_id is null then select id into new.category_id from public.categories where slug='moda' limit 1; end if;
        if not ('moda'=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),'moda'); end if;
        new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.990);
      end if;$new$);

  if position($needle$elsif v_source_category then new.classification_source:='source-category-v41';$needle$ in v_def)=0 then
    raise exception 'classification source block changed';
  end if;
  v_def:=replace(v_def,
    $old$elsif v_source_category then new.classification_source:='source-category-v41';$old$,
    $new$elsif v_pure_fashion then new.classification_source:='store-segment-v90'; elsif v_source_category then new.classification_source:='source-category-v41';$new$);

  execute v_def;
end
$do$;

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
      'filter_group_classifier_checked_version',0,
      'filter_group_requeue_reason','pure-fashion-store-v90',
      'filter_group_requeued_at',now()
    )
where p.is_active=true
  and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
  and public.infer_product_filter_group_pure_fashion_store_v90(p.metadata->>'source_store_slug')='fashion'
  and coalesce(nullif(btrim(p.filter_group),''),'other')='other';
