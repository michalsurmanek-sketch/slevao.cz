-- Source the production process-leaflet dispatchers and keep them internal.
-- Both launchers authenticate the Edge Function with x-cron-secret, so
-- process-leaflet must keep platform verify_jwt disabled and enforce auth itself.

create or replace function public.dispatch_queued_leaflet_imports(batch_size integer default 3)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  item record;
  cron_secret text;
  dispatched integer := 0;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret, '') = '' then
    raise exception 'Missing vault secret slevao_cron_secret';
  end if;

  for item in
    select li.id
    from public.leaflet_imports li
    join public.stores s on s.id = li.store_id
    where li.status = 'queued'
      and coalesce(li.metadata->>'product_batch_key', '') = ''
      and (li.started_at is null or li.started_at < now() - interval '10 minutes')
      and s.slug not in ('billa', 'albert', 'tesco')
    order by li.created_at asc
    limit greatest(1, least(coalesce(batch_size, 3), 10))
    for update of li skip locked
  loop
    update public.leaflet_imports
    set started_at = now(), error_message = null
    where id = item.id;

    perform net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/process-leaflet',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', cron_secret),
      body := jsonb_build_object('import_id', item.id),
      timeout_milliseconds := 10000
    );
    dispatched := dispatched + 1;
  end loop;

  return dispatched;
end;
$function$;

create or replace function public.trigger_process_leaflet_import(p_import_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  v_secret text;
  v_request_id bigint;
begin
  if p_import_id is null then
    raise exception 'Import id is required.';
  end if;

  if not exists (
    select 1
    from public.leaflet_imports
    where id = p_import_id
      and status not in ('published', 'ignored')
  ) then
    raise exception 'Import is not processable.';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(v_secret, '') = '' then
    raise exception 'Cron secret is not configured.';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/process-leaflet',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('import_id', p_import_id),
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end;
$function$;

revoke all on function public.dispatch_queued_leaflet_imports(integer) from public, anon, authenticated;
revoke all on function public.trigger_process_leaflet_import(uuid) from public, anon, authenticated;

grant execute on function public.dispatch_queued_leaflet_imports(integer) to service_role;
grant execute on function public.trigger_process_leaflet_import(uuid) to service_role;
