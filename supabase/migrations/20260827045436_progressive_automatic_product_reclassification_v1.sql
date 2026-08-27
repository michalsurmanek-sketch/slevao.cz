create index if not exists idx_products_auto_reclassify_pending
on public.products(updated_at,id)
where is_active=true and (filter_group is null or btrim(filter_group)='' or filter_group='other');

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
    select p.id,
           public.infer_product_filter_group_auto(p.name,p.category_id,p.quantity_text,p.metadata) as inferred
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
       set filter_group=case when x.inferred<>'other' then x.inferred else p.filter_group end,
           metadata=coalesce(p.metadata,'{}'::jsonb)
             || jsonb_build_object(
                  'filter_group_classifier_checked_version',v_version,
                  'filter_group_classifier_checked_at',now()
                )
             || case when x.inferred<>'other'
                     then jsonb_build_object(
                            'filter_group_source','auto_classifier',
                            'filter_group_classifier_version',v_version
                          )
                     else '{}'::jsonb end,
           updated_at=now()
      from picked x
     where p.id=x.id
    returning (x.inferred<>'other') as changed
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

DO $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-auto-reclassify-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-auto-reclassify-products',
    '37 * * * *',
    'select private.auto_reclassify_products(1000);'
  );
end $$;
