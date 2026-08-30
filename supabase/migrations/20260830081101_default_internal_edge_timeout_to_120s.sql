create or replace function private.invoke_edge_function(
  p_slug text,
  p_body jsonb default '{}'::jsonb,
  p_timeout_milliseconds integer default 120000
)
returns bigint
language plpgsql
security definer
set search_path to 'public','private','vault','net','pg_temp'
as $function$
declare
  v_secret text;
  v_request_id bigint;
begin
  if p_slug !~ '^[a-z0-9-]+$' then
    raise exception 'Invalid Edge Function slug.';
  end if;

  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if coalesce(v_secret, '') = '' then
    raise exception 'Missing internal cron secret.';
  end if;

  select net.http_post(
    url := format('https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/%s', p_slug),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := greatest(1000, least(coalesce(p_timeout_milliseconds, 120000), 120000))
  ) into v_request_id;

  return v_request_id;
end;
$function$;