create or replace function public.trigger_tesco_current_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  cron_secret text;
  request_id bigint;
  source_due boolean := false;
begin
  select exists (
    select 1
    from public.leaflet_sources ls
    join public.stores s on s.id = ls.store_id
    where ls.is_active is true
      and s.slug = 'tesco'
      and (
        ls.last_checked_at is null
        or ls.last_checked_at
          + make_interval(mins => greatest(coalesce(ls.check_interval_minutes, 1440), 30)) <= now()
      )
  ) into source_due;

  if not source_due then
    return null;
  end if;

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-tesco-current',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$function$;
