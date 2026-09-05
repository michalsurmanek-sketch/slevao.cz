create or replace view public.store_product_sync_health
with (security_invoker = true) as
with today as (
  select (now() at time zone 'Europe/Prague')::date as d
),
offer_stats as (
  select
    o.store_id,
    count(*) filter (
      where o.status = 'published'
        and o.is_verified = true
        and o.valid_from <= t.d
        and o.valid_to >= t.d
    )::integer as active_offer_count,
    max(o.updated_at) filter (
      where o.status = 'published'
        and o.is_verified = true
        and o.valid_from <= t.d
        and o.valid_to >= t.d
    ) as last_active_offer_update,
    min(o.valid_from) filter (
      where o.status = 'published'
        and o.is_verified = true
        and o.valid_from <= t.d
        and o.valid_to >= t.d
    ) as active_valid_from,
    max(o.valid_to) filter (
      where o.status = 'published'
        and o.is_verified = true
        and o.valid_from <= t.d
        and o.valid_to >= t.d
    ) as active_valid_to
  from public.offers o
  cross join today t
  group by o.store_id
),
effective as (
  select
    s.slug,
    s.name,
    st.last_run_at,
    greatest(st.last_success_at, os.last_active_offer_update) as effective_last_success_at,
    coalesce(os.active_offer_count, 0) as active_offer_count,
    st.minimum_offer_count,
    st.last_error,
    st.health_status as state_health_status,
    os.active_valid_from as effective_valid_from,
    os.active_valid_to as effective_valid_to
  from public.stores s
  left join public.store_product_sync_state st on st.store_id = s.id
  left join offer_stats os on os.store_id = s.id
)
select
  slug,
  name,
  last_run_at,
  effective_last_success_at as last_success_at,
  active_offer_count as last_offer_count,
  last_error,
  effective_valid_from as last_valid_from,
  effective_valid_to as last_valid_to,
  case
    when state_health_status = any (array['waiting_source'::text, 'not_applicable'::text, 'blocked'::text, 'degraded'::text, 'running'::text]) then state_health_status
    when state_health_status = 'error'::text or last_error is not null then 'error'::text
    when active_offer_count > 0
      and minimum_offer_count is not null
      and active_offer_count < minimum_offer_count then 'degraded'::text
    when active_offer_count > 0 then 'ok'::text
    when effective_last_success_at is null then 'never'::text
    when effective_last_success_at < now() - interval '2 days' then 'stale'::text
    else 'no_offers'::text
  end as health
from effective;
