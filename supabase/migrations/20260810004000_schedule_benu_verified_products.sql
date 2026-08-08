do $$
begin
  if exists(select 1 from cron.job where jobname='sync-benu-verified-products') then
    perform cron.unschedule('sync-benu-verified-products');
  end if;
  perform cron.schedule(
    'sync-benu-verified-products',
    '35 3 * * *',
    $job$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-benu-source',
        headers := jsonb_build_object(
          'content-type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end $$;
