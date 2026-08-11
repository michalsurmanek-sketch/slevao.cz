-- Supabase project is currently at the Edge Function slot limit. Reuse the
-- unscheduled debug-kaufland-source slot for the storage cleanup worker.
create or replace function public.trigger_expired_leaflet_storage_cleanup()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret,'') = '' then
    raise warning 'Vault secret slevao_cron_secret is missing.';
    return null;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/debug-kaufland-source',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := jsonb_build_object('expired_limit',300,'orphan_limit',150,'grace_days',1,'orphan_age_days',7),
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.trigger_expired_leaflet_storage_cleanup() from public;
grant execute on function public.trigger_expired_leaflet_storage_cleanup() to service_role;
