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
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      - 'filter_group_source'
      - 'filter_group_classifier_version';
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    elsif v_old_auto or v_new_auto then
      new.filter_group := 'other';
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.auto_reclassify_products(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,1000),2000));
  v_version integer := public.product_filter_group_classifier_version();
  v_checked integer := 0;
  v_changed integer := 0;
begin
  with picked as materialized (
    select p.id,p.filter_group as old_filter_group
    from public.products p
    where p.is_active=true
      and (
        (
          coalesce(nullif(trim(p.filter_group),''),'other')='other'
          and coalesce(
            case when coalesce(p.metadata->>'filter_group_classifier_checked_version','') ~ '^[0-9]+$'
                 then (p.metadata->>'filter_group_classifier_checked_version')::integer end,
            0
          ) < v_version
        )
        or (
          coalesce(p.metadata->>'filter_group_source','')='auto_classifier'
          and coalesce(
            case when coalesce(p.metadata->>'filter_group_classifier_version','') ~ '^[0-9]+$'
                 then (p.metadata->>'filter_group_classifier_version')::integer end,
            0
          ) < v_version
        )
      )
    order by p.updated_at nulls first,p.created_at,p.id
    limit v_limit
    for update skip locked
  ), upd as (
    update public.products p
       set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
             'filter_group_classifier_checked_version',v_version,
             'filter_group_classifier_checked_at',now()
           ),
           updated_at=now()
      from picked x
     where p.id=x.id
    returning (p.filter_group is distinct from x.old_filter_group) as changed
  )
  select count(*)::integer,
         count(*) filter (where changed)::integer
    into v_checked,v_changed
  from upd;

  return jsonb_build_object(
    'ok',true,
    'classifier_version',v_version,
    'checked',coalesce(v_checked,0),
    'changed',coalesce(v_changed,0)
  );
end;
$$;

revoke all on function private.auto_reclassify_products(integer) from public;
