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
        when c.max_valid_to is null or c.max_valid_to < current_date then 180
        when c.max_valid_to = current_date and not coalesce(c.has_future,false) then 360
        when coalesce(c.has_future,false) then 2880
        when c.max_valid_to <= current_date + 2 then 720
        when c.max_valid_to <= current_date + 7 then 1440
        else 2880
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
      (select count(*)::integer from desired where desired_minutes = 180) as missing_count,
      (select count(*)::integer from desired where desired_minutes in (360,720)) as urgent_count,
      (select count(*)::integer from desired where desired_minutes in (1440,2880)) as healthy_count
  )
  select * from stats;
end;
$$;

create or replace function public.trigger_leaflet_discovery()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  cron_secret text;
  request_id bigint;
begin
  perform private.refresh_leaflet_source_check_intervals();

  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret, '') = '' then
    raise warning 'Vault secret slevao_cron_secret is missing; leaflet discovery was skipped.';
    return null;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/discover-leaflets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function private.refresh_leaflet_source_check_intervals() from public, anon, authenticated;
