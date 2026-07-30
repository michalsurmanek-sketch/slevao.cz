-- Slevao.cz: jednotný administrační přehled stavu zdrojů letáků
create or replace view public.leaflet_source_health as
select
  ls.id,
  ls.store_id,
  s.slug as store_slug,
  s.name as store_name,
  s.logo_url,
  ls.name as source_name,
  ls.source_url,
  ls.source_type,
  ls.is_active,
  ls.auto_publish,
  ls.check_interval_minutes,
  ls.last_checked_at,
  ls.last_success_at,
  ls.last_error,
  case
    when not ls.is_active and ls.last_success_at is null then 'waiting_test'
    when ls.is_active and ls.last_error is null and ls.last_success_at is not null then 'healthy'
    when ls.last_error is not null then 'error'
    when ls.is_active then 'active_not_verified'
    else 'inactive'
  end as health_status,
  case when ls.last_checked_at is null then null
       else floor(extract(epoch from (now() - ls.last_checked_at)) / 60)::integer
  end as minutes_since_check,
  case when ls.last_success_at is null then null
       else floor(extract(epoch from (now() - ls.last_success_at)) / 60)::integer
  end as minutes_since_success
from public.leaflet_sources ls
join public.stores s on s.id = ls.store_id;

grant select on public.leaflet_source_health to authenticated;
