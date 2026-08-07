-- Weekly refresh of official Kaufland branch coordinates.
-- Seven staggered batches avoid a burst of 127 detail-page requests.
-- Secret stays in Supabase Vault and is never exposed to the browser.

select cron.schedule(
  'sync-kaufland-branches-000',
  '0 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":0,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

select cron.schedule(
  'sync-kaufland-branches-020',
  '5 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":20,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

select cron.schedule(
  'sync-kaufland-branches-040',
  '10 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":40,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

select cron.schedule(
  'sync-kaufland-branches-060',
  '15 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":60,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

select cron.schedule(
  'sync-kaufland-branches-080',
  '20 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":80,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

select cron.schedule(
  'sync-kaufland-branches-100',
  '25 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":100,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);

select cron.schedule(
  'sync-kaufland-branches-120',
  '30 2 * * 0',
  $$select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
    ),
    body := '{"dry_run":false,"offset":120,"limit":20}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;$$
);
