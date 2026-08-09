do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'sync-jip-ocr-products-after-ocr' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'sync-jip-ocr-products-after-ocr',
    '17,47 * * * *',
    $job$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-jip-ocr-products',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'slevao_cron_secret' limit 1)
        ),
        body := '{"dry_run":false}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$
  );
end $$;
