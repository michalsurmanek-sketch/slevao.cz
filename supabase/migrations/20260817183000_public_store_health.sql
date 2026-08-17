create or replace function public.get_public_store_health()
returns table(
  store_id uuid,
  slug text,
  name text,
  availability_status text,
  current_count bigint,
  upcoming_count bigint,
  has_active_source boolean,
  last_source_success_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
with today as (
  select (timezone('Europe/Prague',now()))::date as d
), offer_counts as (
  select
    s.id as store_id,
    count(o.id) filter (
      where o.status='published'
        and o.is_verified is true
        and o.valid_from <= t.d
        and o.valid_to >= t.d
    )::bigint as current_count,
    count(o.id) filter (
      where o.status='published'
        and o.is_verified is true
        and o.valid_from > t.d
        and o.valid_from <= t.d + 7
        and o.valid_to >= o.valid_from
    )::bigint as upcoming_count
  from public.stores s
  cross join today t
  left join public.offers o on o.store_id=s.id
  where s.is_active is true
  group by s.id
), source_health as (
  select
    ls.store_id,
    bool_or(ls.is_active) as has_active_source,
    max(ls.last_success_at) filter (where ls.is_active) as last_source_success_at
  from public.leaflet_sources ls
  group by ls.store_id
)
select
  s.id as store_id,
  s.slug,
  s.name,
  case
    when coalesce(oc.current_count,0) > 0 then 'live'
    when coalesce(oc.upcoming_count,0) > 0 then 'upcoming'
    when coalesce(sh.has_active_source,false) then 'waiting_source'
    else 'catalog_only'
  end as availability_status,
  coalesce(oc.current_count,0) as current_count,
  coalesce(oc.upcoming_count,0) as upcoming_count,
  coalesce(sh.has_active_source,false) as has_active_source,
  sh.last_source_success_at
from public.stores s
left join offer_counts oc on oc.store_id=s.id
left join source_health sh on sh.store_id=s.id
where s.is_active is true
order by s.name;
$function$;

grant execute on function public.get_public_store_health() to anon, authenticated, service_role;
