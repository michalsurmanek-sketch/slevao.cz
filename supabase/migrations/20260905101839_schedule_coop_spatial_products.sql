do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='sync-coop-spatial-products' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'sync-coop-spatial-products',
  '45 */3 * * *',
  $cron$
    select net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-coop-pdf-text-products',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
      ),
      body := '{"dry_run":false}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
