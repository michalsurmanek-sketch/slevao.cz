create or replace function public.invoke_norma_branch_diagnostic(
  p_city text default 'Praha',
  p_radius integer default 500000
)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_catalog
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;
  if nullif(v_secret, '') is null then raise exception 'slevao_cron_secret is missing from Vault'; end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-norma-branches',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body := jsonb_build_object(
      'dry_run', true,
      'mode', 'diagnose',
      'city', p_city,
      'radius', p_radius
    ),
    timeout_milliseconds := 45000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.invoke_norma_branch_diagnostic(text,integer) from public, anon, authenticated;
grant execute on function public.invoke_norma_branch_diagnostic(text,integer) to service_role;
