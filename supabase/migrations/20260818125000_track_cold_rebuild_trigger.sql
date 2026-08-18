create or replace function public.trigger_cold_rebuild_store(p_store_slug text)
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
  where name='slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret,'')='' then
    raise exception 'Vault secret slevao_cron_secret is missing.';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/cold-rebuild-store',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := jsonb_build_object('store_slug',lower(trim(p_store_slug)),'confirmation','STUDENY REBUILD'),
    timeout_milliseconds := 180000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.trigger_cold_rebuild_store(text) from public;
revoke all on function public.trigger_cold_rebuild_store(text) from anon;
revoke all on function public.trigger_cold_rebuild_store(text) from authenticated;
grant execute on function public.trigger_cold_rebuild_store(text) to service_role;
