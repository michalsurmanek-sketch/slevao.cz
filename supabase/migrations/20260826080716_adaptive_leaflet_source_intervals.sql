create or replace function private.refresh_leaflet_source_check_intervals()
returns table(updated_count integer, missing_count integer, urgent_count integer, healthy_count integer)
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  return query
  with coverage as (
    select
      ls.id as source_id,
      max(li.detected_valid_to) filter (
        where li.status in ('published','review')
          and li.detected_valid_to is not null
      ) as max_valid_to,
      bool_or(
        li.status in ('published','review')
        and li.detected_valid_from is not null
        and li.detected_valid_from > current_date
        and (li.detected_valid_to is null or li.detected_valid_to >= li.detected_valid_from)
      ) as has_future
    from public.leaflet_sources ls
    left join public.leaflet_imports li on li.source_id = ls.id
    where ls.is_active is true
    group by ls.id
  ), desired as (
    select
      ls.id,
      case
        when c.max_valid_to is null or c.max_valid_to < current_date then 60
        when c.max_valid_to = current_date and not coalesce(c.has_future,false) then 120
        when coalesce(c.has_future,false) then 1440
        when c.max_valid_to <= current_date + 2 then 360
        when c.max_valid_to <= current_date + 7 then 720
        else 1440
      end as desired_minutes
    from public.leaflet_sources ls
    join coverage c on c.source_id = ls.id
    where ls.is_active is true
  ), changed as (
    update public.leaflet_sources ls
    set check_interval_minutes = d.desired_minutes,
        updated_at = now()
    from desired d
    where ls.id = d.id
      and ls.check_interval_minutes is distinct from d.desired_minutes
    returning ls.id, d.desired_minutes
  ), stats as (
    select
      (select count(*)::integer from changed) as updated_count,
      (select count(*)::integer from desired where desired_minutes = 60) as missing_count,
      (select count(*)::integer from desired where desired_minutes in (120,360)) as urgent_count,
      (select count(*)::integer from desired where desired_minutes in (720,1440)) as healthy_count
  )
  select * from stats;
end;
$$;

revoke all on function private.refresh_leaflet_source_check_intervals() from public, anon, authenticated;
