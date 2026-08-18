alter table public.public_leaflet_source_health_snapshot
  add column if not exists product_source_state text;

create or replace function public.refresh_public_leaflet_source_health(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_state text;
begin
  if p_store_id is null then return; end if;

  select case
    when sp.health_status = 'waiting_source' then 'waiting_source'
    when sp.health_status = 'blocked' then 'blocked'
    when sp.health_status = 'not_applicable' then 'not_applicable'
    else null
  end
  into v_product_state
  from public.store_product_sync_state sp
  where sp.store_id = p_store_id
  limit 1;

  insert into public.public_leaflet_source_health_snapshot(
    store_id,
    active_source_count,
    last_source_check,
    last_source_success,
    has_current_source_error,
    max_check_interval_minutes,
    waiting_source,
    product_source_state,
    updated_at
  )
  select
    p_store_id,
    count(*) filter (where ls.is_active is true)::bigint,
    max(ls.last_checked_at) filter (where ls.is_active is true),
    max(ls.last_success_at) filter (where ls.is_active is true),
    coalesce(bool_or(
      ls.is_active is true
      and ls.last_error is not null
      and (ls.last_success_at is null or ls.last_checked_at >= ls.last_success_at)
    ), false),
    max(greatest(coalesce(ls.check_interval_minutes, 720), 60)) filter (where ls.is_active is true),
    coalesce(v_product_state = 'waiting_source', false),
    v_product_state,
    now()
  from public.leaflet_sources ls
  where ls.store_id = p_store_id
  on conflict (store_id) do update set
    active_source_count = excluded.active_source_count,
    last_source_check = excluded.last_source_check,
    last_source_success = excluded.last_source_success,
    has_current_source_error = excluded.has_current_source_error,
    max_check_interval_minutes = excluded.max_check_interval_minutes,
    waiting_source = excluded.waiting_source,
    product_source_state = excluded.product_source_state,
    updated_at = excluded.updated_at;
end;
$$;

select public.refresh_public_leaflet_source_health(s.id)
from public.stores s;

create or replace view public.public_store_feed_health
with (security_invoker = true)
as
with today as (
  select timezone('Europe/Prague', now())::date as d, now() as ts
), offer_stats as (
  select o.store_id,
    count(*) filter (where o.status='published' and o.is_verified is true and o.valid_from<=t.d and o.valid_to>=t.d) as current_offer_count,
    count(*) filter (where o.status='published' and o.is_verified is true and o.valid_from<=t.d and o.valid_to>=t.d and coalesce(o.image_url,p.image_url) is not null) as current_offer_image_count,
    max(o.updated_at) filter (where o.status='published' and o.is_verified is true) as last_offer_update
  from public.offers o
  cross join today t
  left join public.products p on p.id=o.product_id
  group by o.store_id
), leaflet_stats as (
  select li.store_id,
    count(*) filter (where li.status='published' and coalesce(li.detected_valid_from,t.d)<=t.d and coalesce(li.detected_valid_to,t.d)>=t.d) as current_leaflet_count,
    max(li.updated_at) filter (where li.status='published') as last_leaflet_update
  from public.leaflet_imports li
  cross join today t
  group by li.store_id
)
select s.id as store_id,s.slug,s.name,s.logo_url,s.primary_color,s.is_active,s.is_verified,
  coalesce(o.current_offer_count,0::bigint) as current_offer_count,
  coalesce(o.current_offer_image_count,0::bigint) as current_offer_image_count,
  case when coalesce(o.current_offer_count,0)>0
    then round(100.0*coalesce(o.current_offer_image_count,0)::numeric/o.current_offer_count::numeric,1)
    else 0::numeric end as image_coverage_pct,
  coalesce(l.current_leaflet_count,0::bigint) as current_leaflet_count,
  coalesce(src.active_source_count,0::bigint) as active_source_count,
  o.last_offer_update,l.last_leaflet_update,src.last_source_check,src.last_source_success,
  coalesce(src.has_current_source_error,false) as has_current_source_error,
  case
    when s.is_active is not true then 'disabled'
    when coalesce(o.current_offer_count,0)>0 then 'products-live'
    when coalesce(l.current_leaflet_count,0)>0 then 'leaflet-only'
    when src.product_source_state = 'not_applicable' then 'not-applicable'
    when src.product_source_state = 'blocked' then 'source-blocked'
    when coalesce(src.waiting_source,false) then 'temporarily-empty'
    when coalesce(src.active_source_count,0)>0 and (
      coalesce(src.has_current_source_error,false)
      or src.last_source_success is null
      or src.last_source_success < ((select ts from today)-make_interval(mins=>greatest(coalesce(src.max_check_interval_minutes,720)*2,1440)))
    ) then 'broken-source'
    when coalesce(src.active_source_count,0)>0 then 'temporarily-empty'
    else 'supported'
  end as feed_status,
  case
    when coalesce(o.current_offer_count,0)=0 then 0
    when coalesce(o.current_offer_count,0)>=100 then 100
    else least(100,round(coalesce(o.current_offer_count,0)::numeric/100*70 + coalesce(o.current_offer_image_count,0)::numeric/o.current_offer_count::numeric*30,0))
  end::integer as health_score
from public.stores s
left join offer_stats o on o.store_id=s.id
left join leaflet_stats l on l.store_id=s.id
left join public.public_leaflet_source_health_snapshot src on src.store_id=s.id;
