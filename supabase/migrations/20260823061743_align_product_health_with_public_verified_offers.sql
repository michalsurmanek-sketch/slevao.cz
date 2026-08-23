create or replace view public.store_product_sync_health
with (security_invoker=true)
as
with today as (
  select (now() at time zone 'Europe/Prague')::date as d
), offer_stats as (
  select o.store_id,
         count(*) filter (
           where o.status='published'
             and o.is_verified=true
             and o.valid_from <= t.d
             and o.valid_to >= t.d
         )::integer as active_offer_count,
         max(o.updated_at) filter (
           where o.status='published'
             and o.is_verified=true
             and o.valid_from <= t.d
             and o.valid_to >= t.d
         ) as last_active_offer_update,
         min(o.valid_from) filter (
           where o.status='published'
             and o.is_verified=true
             and o.valid_from <= t.d
             and o.valid_to >= t.d
         ) as active_valid_from,
         max(o.valid_to) filter (
           where o.status='published'
             and o.is_verified=true
             and o.valid_from <= t.d
             and o.valid_to >= t.d
         ) as active_valid_to
  from public.offers o
  cross join today t
  group by o.store_id
), effective as (
  select s.slug,
         s.name,
         st.last_run_at,
         greatest(st.last_success_at, os.last_active_offer_update) as effective_last_success_at,
         coalesce(os.active_offer_count,0) as active_offer_count,
         st.last_error,
         os.active_valid_from as effective_valid_from,
         os.active_valid_to as effective_valid_to
  from public.stores s
  left join public.store_product_sync_state st on st.store_id=s.id
  left join offer_stats os on os.store_id=s.id
)
select slug,
       name,
       last_run_at,
       effective_last_success_at as last_success_at,
       active_offer_count as last_offer_count,
       last_error,
       effective_valid_from as last_valid_from,
       effective_valid_to as last_valid_to,
       case
         when last_error is not null and active_offer_count=0 then 'error'::text
         when effective_last_success_at is null then 'never'::text
         when active_offer_count>0 then 'ok'::text
         when effective_last_success_at < now()-interval '2 days' then 'stale'::text
         else 'no_offers'::text
       end as health
from effective;

create or replace function public.get_automation_health(p_days integer default 30)
returns table(
  store_id uuid,
  store_slug text,
  store_name text,
  active_sources bigint,
  last_checked_at timestamptz,
  imports_total bigint,
  imports_failed bigint,
  imports_success bigint,
  failure_rate numeric,
  active_offers bigint,
  offers_with_image bigint,
  image_coverage numeric,
  last_import_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  health_status text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  v_role := lower(coalesce(auth.jwt()->'app_metadata'->>'role',''));
  if v_role not in ('admin','editor') then
    raise exception 'Unauthorized';
  end if;

  return query
  with today as (
    select (now() at time zone 'Europe/Prague')::date as d
  ), source_stats as (
    select ls.store_id,
      count(*) filter(where ls.is_active) as active_sources,
      max(ls.last_checked_at) as last_checked_at
    from public.leaflet_sources ls
    group by ls.store_id
  ), import_stats as (
    select li.store_id,
      count(*) as imports_total,
      count(*) filter(where li.status='failed') as imports_failed,
      count(*) filter(where li.status in ('review','published')) as imports_success,
      max(li.created_at) as last_import_at,
      max(li.finished_at) filter(where li.status in ('review','published')) as last_success_at,
      max(li.finished_at) filter(where li.status='failed') as last_failure_at
    from public.leaflet_imports li
    where li.created_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365)))
    group by li.store_id
  ), last_fail as (
    select distinct on (li.store_id) li.store_id, li.error_message
    from public.leaflet_imports li
    where li.status='failed'
    order by li.store_id, coalesce(li.finished_at,li.updated_at,li.created_at) desc
  ), offer_stats as (
    select o.store_id,
      count(*) filter(
        where o.status='published'
          and o.is_verified=true
          and o.valid_from <= t.d
          and o.valid_to >= t.d
      ) as active_offers,
      count(*) filter(
        where o.status='published'
          and o.is_verified=true
          and o.valid_from <= t.d
          and o.valid_to >= t.d
          and coalesce(nullif(o.image_url,''),'')<>''
      ) as offers_with_image
    from public.offers o
    cross join today t
    group by o.store_id
  )
  select s.id,s.slug,s.name,
    coalesce(ss.active_sources,0),ss.last_checked_at,
    coalesce(i.imports_total,0),coalesce(i.imports_failed,0),coalesce(i.imports_success,0),
    case when coalesce(i.imports_total,0)>0 then round(100.0*i.imports_failed/i.imports_total,1) else 0 end,
    coalesce(o.active_offers,0),coalesce(o.offers_with_image,0),
    case when coalesce(o.active_offers,0)>0 then round(100.0*o.offers_with_image/o.active_offers,1) else 0 end,
    i.last_import_at,i.last_success_at,i.last_failure_at,lf.error_message,
    case
      when coalesce(ss.active_sources,0)=0 then 'inactive'
      when coalesce(i.imports_total,0)=0 and (ss.last_checked_at is null or ss.last_checked_at<now()-interval '24 hours') then 'stale'
      when coalesce(i.imports_total,0)>=3 and 100.0*i.imports_failed/nullif(i.imports_total,0)>=80 then 'critical'
      when coalesce(i.imports_total,0)>=3 and 100.0*i.imports_failed/nullif(i.imports_total,0)>=40 then 'warning'
      when coalesce(o.active_offers,0)=0 and coalesce(i.imports_success,0)>0 then 'no_offers'
      when coalesce(o.active_offers,0)>0 then 'healthy'
      else 'unknown'
    end
  from public.stores s
  left join source_stats ss on ss.store_id=s.id
  left join import_stats i on i.store_id=s.id
  left join last_fail lf on lf.store_id=s.id
  left join offer_stats o on o.store_id=s.id
  where coalesce(ss.active_sources,0)>0 or coalesce(i.imports_total,0)>0 or coalesce(o.active_offers,0)>0
  order by case
    when coalesce(i.imports_total,0)>=3 and 100.0*i.imports_failed/nullif(i.imports_total,0)>=80 then 1
    when coalesce(i.imports_total,0)>=3 and 100.0*i.imports_failed/nullif(i.imports_total,0)>=40 then 2
    when coalesce(o.active_offers,0)=0 then 3 else 4 end,
    s.name;
end;
$$;
