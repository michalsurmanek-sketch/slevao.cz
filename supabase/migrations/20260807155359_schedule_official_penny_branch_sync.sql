-- Weekly refresh of official PENNY branch coordinates.
-- The official PENNY storefinder SSR payload contains the full Czech store network,
-- so one request is sufficient. Secret stays in Supabase Vault.

select cron.schedule(
  'sync-penny-branches',
  '40 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"source":"penny_official"}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);
