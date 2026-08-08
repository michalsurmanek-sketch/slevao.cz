-- Internal helper for retrying a specific leaflet import without exposing the
-- cron secret to callers or application code.

create or replace function public.trigger_publish_import(p_import_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  cron_secret text;
  request_id bigint;
begin
  if p_import_id is null then
    raise exception 'Import id is required.';
  end if;

  if not exists (
    select 1
    from public.leaflet_imports li
    where li.id = p_import_id
      and li.status in ('review', 'publishing')
  ) then
    raise exception 'Import is not ready for publishing.';
  end if;

  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret, '') = '' then
    raise exception 'Cron secret is not configured.';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/publish-imports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('import_id', p_import_id),
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$function$;

revoke all on function public.trigger_publish_import(uuid) from public, anon, authenticated;
grant execute on function public.trigger_publish_import(uuid) to service_role;