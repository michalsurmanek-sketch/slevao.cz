create or replace function public.infer_product_filter_group_activity_v28(
  p_name text,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,'')));
  v_source_store text := lower(coalesce(p_metadata->>'source_store_slug',''));
begin
  if v_source_store in ('sportisimo','intersport') then
    if n ~ '(^| )(tricko|tee|t shirt|short|shorts|sortky|kratasy|pantofle|ponozky|polo|jogger|hoodie|jacket|batoh|backpack|obuv|boty)( |$)' then
      return 'fashion';
    end if;
    return 'sports';
  end if;

  if v_source_store='globus' and n ~ '(^| )(fotbalovy mic|skateboard detsky)( |$)' then return 'sports'; end if;
  if v_source_store='kaufland' and n ~ '(^| )(newcential sada raket na stolni tenis|newcential trekingove hole|countryside bazen quick up)( |$)' then return 'sports'; end if;
  if v_source_store='tedi' and n ~ '(^| )volejbalovy mic( |$)' then return 'sports'; end if;

  if v_source_store='action' and n ~ '(^| )puzzle ruzne varianty( |$)' then return 'toys'; end if;
  if v_source_store='globus' and n ~ '(^| )(bublifuky svetelkujici blaster|lego minecraft|simba objevuj mini laborator)( |$)' then return 'toys'; end if;
  if v_source_store='kaufland' and n ~ '(^| )(lupilu sada bublifuku|matematicky valec|puzzle hodiny|stitch kniha aktivit|stitch sada pro deti|xtra plysova figurka)( |$)' then return 'toys'; end if;
  if v_source_store='kosik' and n ~ '(^| )teddies( |$)' and n ~ '(^| )vesta( |$)' then return 'fashion'; end if;
  if v_source_store='kosik' and (n ~ '(^| )pop mart labubu( |$)' or n ~ '(^| )teddies( |$)') then return 'toys'; end if;
  if v_source_store='tedi' and n ~ '(^| )(penovy mic do vody|rodinny bazenek|vodni mic)( |$)' then return 'toys'; end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 28 $$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_inferred text;
  v_version integer := public.product_filter_group_classifier_version();
  v_old_auto boolean := false;
  v_new_auto boolean := false;
  v_explicit_change boolean := false;
begin
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';

  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;

  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version')
      || jsonb_build_object(
        'filter_group_source','explicit',
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text);
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_source_rules(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);
    end if;

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object(
          'filter_group_source','auto_classifier',
          'filter_group_classifier_version',v_version
        );
      end if;
    end if;
  end if;

  return new;
end;
$function$;
