create or replace function public.invoke_billa_publitas_sync()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_catalog
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  limit 1;

  if nullif(v_secret,'') is null then
    raise exception 'slevao_cron_secret is missing from Vault';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-billa-publitas',
    headers := jsonb_build_object('content-type','application/json','x-cron-secret',v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_billa_publitas_sync() from public, anon, authenticated;
grant execute on function public.invoke_billa_publitas_sync() to service_role;

do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname='sync-billa-publitas-rollover'
  loop perform cron.unschedule(v_job.jobid); end loop;
end;
$$;

select cron.schedule(
  'sync-billa-publitas-rollover',
  '17 */3 * * *',
  'select public.invoke_billa_publitas_sync();'
);
