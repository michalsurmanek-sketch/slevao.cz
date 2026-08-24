do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'sync-jip-html-consensus-products' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'sync-jip-html-consensus-products',
    '22,52 * * * *',
    $cmd$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-jip-html-consensus-products',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'slevao_cron_secret' limit 1)
        ),
        body := '{"dry_run":false}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cmd$
  );
end
$$;
