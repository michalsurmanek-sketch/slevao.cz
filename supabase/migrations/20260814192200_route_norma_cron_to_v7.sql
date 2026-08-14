select cron.alter_job(82, command := $$
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-norma-pdf-products-v7',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false}'::jsonb
  );
$$);
