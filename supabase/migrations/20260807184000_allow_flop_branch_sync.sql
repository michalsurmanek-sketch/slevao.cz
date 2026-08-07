create or replace function public.invoke_store_branch_sync(
  p_source text,
  p_dry_run boolean default true,
  p_offset integer default null,
  p_limit integer default null
)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_catalog
as $$
declare
  v_secret text;
  v_body jsonb;
  v_request_id bigint;
begin
  if p_source not in ('kaufland_official','penny_official','albert_official','billa_official','flop_official') then
    raise exception 'Unsupported branch sync source: %', p_source;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if nullif(v_secret, '') is null then
    raise exception 'slevao_cron_secret is missing from Vault';
  end if;

  v_body := jsonb_build_object('source', p_source, 'dry_run', p_dry_run);
  if p_offset is not null then v_body := v_body || jsonb_build_object('offset', greatest(0, p_offset)); end if;
  if p_limit is not null then v_body := v_body || jsonb_build_object('limit', greatest(1, least(20, p_limit))); end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-store-branches',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body := v_body,
    timeout_milliseconds := 45000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_store_branch_sync(text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.invoke_store_branch_sync(text, boolean, integer, integer) to service_role;