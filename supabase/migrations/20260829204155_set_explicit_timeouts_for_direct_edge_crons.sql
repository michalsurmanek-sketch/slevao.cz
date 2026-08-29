do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('sync-terno-ocr-products-after-ocr','sync-jysk-verified-products-daily','sync-norma-verified-products')
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'sync-terno-ocr-products-after-ocr',
  '*/30 * * * *',
  $job$
    select net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-terno-ocr-products-v4',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
      ),
      body := '{"dry_run":false}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

select cron.schedule(
  'sync-jysk-verified-products-daily',
  '20 4 * * *',
  $job$
    select net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-jysk-products',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
      ),
      body := '{"dry_run":false}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

select cron.schedule(
  'sync-norma-verified-products',
  '10 */6 * * *',
  $job$
    select net.http_post(
      url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-norma-pdf-products-v7',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
      ),
      body := '{"dry_run":false}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
