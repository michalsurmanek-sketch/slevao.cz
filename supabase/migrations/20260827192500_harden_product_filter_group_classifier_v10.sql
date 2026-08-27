-- High-confidence corrections for recurring public product classification errors.
-- Keep this layer intentionally narrow: it may override only missing/auto groups,
-- never a human/explicit classification change.

create or replace function public.infer_product_filter_group_high_confidence(
  p_name text,
  p_quantity_text text default null
)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,'')));
begin
  -- Meat / prepared meat identities that were repeatedly falling through to other.
  if n ~ '(^| )(pelmeni)( |$)'
     or n ~ '(^| )mlet[a-z0-9]* masov[a-z0-9]* smes( |$)'
     or n ~ '(^| )valassk[a-z0-9]* prsut( |$)'
     or n ~ '(^| )susene maso( |$)' then
    return 'food';
  end if;

  -- Strong beverage identities. Avoid generic "vino" rules because glassware can contain it.
  if n ~ '(^| )klastorna kalcia( |$)'
     or n ~ '(^| )prirodni mineralni (jemne )?sycena( |$)'
     or n ~ '(^| )wiag vino( |$)' then
    return 'drinks';
  end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to ''
as $function$ select 10; $function$;

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
    new.metadata := (coalesce(new.metadata,'{}'::jsonb)
      - 'filter_group_classifier_version')
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

-- Re-run the classifier only for the narrow set covered by the new v10 rules.
update public.products
set name = name
where public.infer_product_filter_group_high_confidence(name,quantity_text) <> 'other'
  and (
    coalesce(nullif(trim(filter_group),''),'other')='other'
    or coalesce(metadata->>'filter_group_source','')='auto_classifier'
  );
