-- Keep the official BAUHAUS leaflet source and strict catalog-validated parser fresh.
-- Source runs first; product parsing follows after the PDF text extraction window.

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in ('sync-bauhaus-source-daily', 'sync-bauhaus-verified-products')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$$;

select cron.schedule(
  'sync-bauhaus-source-daily',
  '35 6 * * *',
  $job$
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-bauhaus-source',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'slevao_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'sync-bauhaus-verified-products',
  '50 6 * * *',
  $job$
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-bauhaus-products',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'slevao_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
