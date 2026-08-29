create or replace function public.infer_product_filter_group_pilulka_v31(
  p_name text,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
parallel safe
set search_path to 'public','pg_temp'
as $$
declare
  n text := public.normalize_text(coalesce(p_name,''));
  v_source_store text := lower(coalesce(p_metadata->>'source_store_slug',''));
begin
  if v_source_store <> 'pilulka' then return 'other'; end if;

  if n ~ '(^| )(crunchy corn|bio kokosova mouka|kokosova mouka|bio ovocne smoothie kousky susene mrazem|flapjack kokos|mandlove maslo kokos a bila cokolada|musli srdcem)( |$)' then
    return 'food';
  end if;

  if n ~ '(^| )(oves zero sugar|ryzovy napoj|bily caj showman malina|detsky caj s echinaceou)( |$)' then
    return 'drinks';
  end if;

  return 'other';
end;
$$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 31 $$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
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
      v_inferred := public.infer_product_filter_group_pilulka_v31(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata);
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
$$;

update public.products
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('filter_group_source','auto_classifier')
where lower(coalesce(metadata->>'source_store_slug',''))='pilulka'
  and filter_group='pharmacy'
  and normalized_name ~ '(^| )(crunchy corn|bio kokosova mouka|kokosova mouka|bio ovocne smoothie kousky susene mrazem|flapjack kokos|mandlove maslo kokos a bila cokolada|musli srdcem|oves zero sugar|ryzovy napoj|bily caj showman malina|detsky caj s echinaceou)( |$)';

update public.products
set classification_source='auto_classifier_v31',
    classification_confidence=0.99,
    classified_at=now()
where lower(coalesce(metadata->>'source_store_slug',''))='pilulka'
  and coalesce(metadata->>'filter_group_source','')='auto_classifier'
  and coalesce((metadata->>'filter_group_classifier_version')::integer,0)=31
  and normalized_name ~ '(^| )(crunchy corn|bio kokosova mouka|kokosova mouka|bio ovocne smoothie kousky susene mrazem|flapjack kokos|mandlove maslo kokos a bila cokolada|musli srdcem|oves zero sugar|ryzovy napoj|bily caj showman malina|detsky caj s echinaceou)( |$)';
