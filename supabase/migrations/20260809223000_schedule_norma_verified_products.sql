do $$
begin
  if exists (select 1 from cron.job where jobname='sync-norma-verified-products') then
    perform cron.unschedule('sync-norma-verified-products');
  end if;
  perform cron.schedule(
    'sync-norma-verified-products',
    '10 */6 * * *',
    $job$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-norma-pdf-products',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
        ),
        body := '{"dry_run":false}'::jsonb
      );
    $job$
  );
end $$;
