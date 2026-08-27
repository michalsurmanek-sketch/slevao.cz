create index if not exists idx_products_auto_reclassify_pending_v2
on public.products(updated_at desc nulls last,id desc)
where is_active=true and (filter_group is null or btrim(filter_group)='' or filter_group='other');

create index if not exists idx_products_auto_classifier_owned_v1
on public.products(updated_at desc nulls last,id desc)
where is_active=true and (metadata->>'filter_group_source')='auto_classifier';

create or replace function private.auto_reclassify_products(p_limit integer default 750)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,750),1500));
  v_version integer := public.product_filter_group_classifier_version();
  v_checked integer := 0;
  v_changed integer := 0;
begin
  with unresolved as materialized (
    select p.id,p.filter_group as old_filter_group
    from public.products p
    where p.is_active=true
      and (p.filter_group is null or btrim(p.filter_group)='' or p.filter_group='other')
      and coalesce(p.metadata->>'filter_group_source','') <> 'explicit'
      and coalesce(
            case when coalesce(p.metadata->>'filter_group_classifier_checked_version','') ~ '^[0-9]+$'
                 then (p.metadata->>'filter_group_classifier_checked_version')::integer end,
            0
          ) < v_version
    order by p.updated_at desc nulls last,p.id desc
    limit v_limit
    for update skip locked
  ), room as (
    select greatest(v_limit-count(*)::integer,0) as remaining from unresolved
  ), auto_old as materialized (
    select p.id,p.filter_group as old_filter_group
    from public.products p, room r
    where r.remaining>0
      and p.is_active=true
      and (p.metadata->>'filter_group_source')='auto_classifier'
      and coalesce(
            case when coalesce(p.metadata->>'filter_group_classifier_version','') ~ '^[0-9]+$'
                 then (p.metadata->>'filter_group_classifier_version')::integer end,
            0
          ) < v_version
      and not exists(select 1 from unresolved u where u.id=p.id)
    order by p.updated_at desc nulls last,p.id desc
    limit (select remaining from room)
    for update of p skip locked
  ), picked as materialized (
    select * from unresolved
    union all
    select * from auto_old
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

DO $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-auto-reclassify-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-auto-reclassify-products',
    '7 * * * *',
    'select private.auto_reclassify_products(750);'
  );
end $$;
