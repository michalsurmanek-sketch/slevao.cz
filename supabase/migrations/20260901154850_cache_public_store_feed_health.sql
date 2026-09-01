create table if not exists public.public_store_feed_health_cache (
  store_id uuid primary key references public.stores(id) on delete cascade,
  current_offer_count bigint not null default 0,
  current_offer_image_count bigint not null default 0,
  current_leaflet_count bigint not null default 0,
  last_offer_update timestamptz,
  last_leaflet_update timestamptz,
  refreshed_at timestamptz not null default now()
);

alter table public.public_store_feed_health_cache enable row level security;

drop policy if exists "public read store feed health cache" on public.public_store_feed_health_cache;
create policy "public read store feed health cache"
on public.public_store_feed_health_cache
for select
to anon, authenticated
using (true);

revoke all on table public.public_store_feed_health_cache from public, anon, authenticated;
grant select on table public.public_store_feed_health_cache to anon, authenticated;
grant all on table public.public_store_feed_health_cache to service_role;

create or replace function private.refresh_public_store_feed_health_cache()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_count integer;
begin
  with today as (
    select timezone('Europe/Prague', now())::date as d
  ), offer_stats as (
    select
      o.store_id,
      count(*) as current_offer_count,
      count(*) filter (where coalesce(o.image_url, p.image_url) is not null) as current_offer_image_count,
      max(o.updated_at) as last_offer_update
    from public.offers o
    cross join today t
    left join public.products p on p.id = o.product_id
    where o.status = 'published'
      and o.is_verified is true
      and o.valid_from <= t.d
      and o.valid_to >= t.d
    group by o.store_id
  ), leaflet_stats as (
    select
      li.store_id,
      count(*) as current_leaflet_count,
      max(li.updated_at) as last_leaflet_update
    from public.leaflet_imports li
    cross join today t
    where li.status = 'published'
      and coalesce(li.detected_valid_from, t.d) <= t.d
      and coalesce(li.detected_valid_to, t.d) >= t.d
    group by li.store_id
  )
  insert into public.public_store_feed_health_cache (
    store_id,
    current_offer_count,
    current_offer_image_count,
    current_leaflet_count,
    last_offer_update,
    last_leaflet_update,
    refreshed_at
  )
  select
    s.id,
    coalesce(o.current_offer_count, 0),
    coalesce(o.current_offer_image_count, 0),
    coalesce(l.current_leaflet_count, 0),
    o.last_offer_update,
    l.last_leaflet_update,
    now()
  from public.stores s
  left join offer_stats o on o.store_id = s.id
  left join leaflet_stats l on l.store_id = s.id
  on conflict (store_id) do update set
    current_offer_count = excluded.current_offer_count,
    current_offer_image_count = excluded.current_offer_image_count,
    current_leaflet_count = excluded.current_leaflet_count,
    last_offer_update = excluded.last_offer_update,
    last_leaflet_update = excluded.last_leaflet_update,
    refreshed_at = excluded.refreshed_at;

  delete from public.public_store_feed_health_cache cache
  where not exists (
    select 1 from public.stores s where s.id = cache.store_id
  );

  select count(*)::integer into v_count
  from public.public_store_feed_health_cache;
  return v_count;
end;
$$;

revoke all on function private.refresh_public_store_feed_health_cache() from public, anon, authenticated;
grant execute on function private.refresh_public_store_feed_health_cache() to service_role;

select private.refresh_public_store_feed_health_cache();

create or replace view public.public_store_feed_health
with (security_invoker = true)
as
select
  s.id as store_id,
  s.slug,
  s.name,
  s.logo_url,
  s.primary_color,
  s.is_active,
  s.is_verified,
  coalesce(cache.current_offer_count, 0::bigint) as current_offer_count,
  coalesce(cache.current_offer_image_count, 0::bigint) as current_offer_image_count,
  case
    when coalesce(cache.current_offer_count, 0) > 0
      then round(100.0 * coalesce(cache.current_offer_image_count, 0)::numeric / cache.current_offer_count::numeric, 1)
    else 0::numeric
  end as image_coverage_pct,
  coalesce(cache.current_leaflet_count, 0::bigint) as current_leaflet_count,
  coalesce(src.active_source_count, 0::bigint) as active_source_count,
  cache.last_offer_update,
  cache.last_leaflet_update,
  src.last_source_check,
  src.last_source_success,
  coalesce(src.has_current_source_error, false) as has_current_source_error,
  case
    when s.is_active is not true then 'disabled'
    when coalesce(cache.current_offer_count, 0) > 0 then 'products-live'
    when coalesce(cache.current_leaflet_count, 0) > 0 then 'leaflet-only'
    when src.product_source_state = 'not_applicable' then 'not-applicable'
    when src.product_source_state = 'blocked' then 'source-blocked'
    when coalesce(src.waiting_source, false) then 'temporarily-empty'
    when coalesce(src.active_source_count, 0) > 0 and (
      coalesce(src.has_current_source_error, false)
      or src.last_source_success is null
      or src.last_source_success < now() - make_interval(mins => greatest(coalesce(src.max_check_interval_minutes, 720) * 2, 1440))
    ) then 'broken-source'
    when coalesce(src.active_source_count, 0) > 0 then 'temporarily-empty'
    else 'supported'
  end as feed_status,
  case
    when coalesce(cache.current_offer_count, 0) = 0 then 0
    when coalesce(cache.current_offer_count, 0) >= 100 then 100
    else least(
      100,
      round(
        coalesce(cache.current_offer_count, 0)::numeric / 100 * 70
        + coalesce(cache.current_offer_image_count, 0)::numeric / cache.current_offer_count::numeric * 30,
        0
      )
    )
  end::integer as health_score
from public.stores s
left join public.public_store_feed_health_cache cache on cache.store_id = s.id
left join public.public_leaflet_source_health_snapshot src on src.store_id = s.id;

grant select on public.public_store_feed_health to anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'refresh-public-store-feed-health-cache'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'refresh-public-store-feed-health-cache',
    '*/5 * * * *',
    $cron$select private.refresh_public_store_feed_health_cache();$cron$
  );
end;
$$;
