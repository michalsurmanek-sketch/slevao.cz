select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'sync-jip-ocr-products-after-ocr'),
  command := $$
    select net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-jip-pack-products',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'slevao_cron_secret' limit 1)
      ),
      body := '{"dry_run":false}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
