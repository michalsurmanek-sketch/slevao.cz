do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync-jip-ocr-products-after-ocr';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'sync-jip-ocr-products-after-ocr',
    '17,47 * * * *',
    $cron$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-jip-pack-products',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'slevao_cron_secret' limit 1)
        ),
        body := '{"dry_run":false}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cron$
  );

  select jobid into v_job from cron.job where jobname='sync-zabka-verified-products';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'sync-zabka-verified-products',
    '40 6 * * *',
    $cron$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-zabka-products',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'slevao_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cron$
  );
end $$;