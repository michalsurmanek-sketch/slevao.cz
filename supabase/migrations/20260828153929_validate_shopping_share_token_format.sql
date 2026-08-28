create or replace function public.resolve_shopping_list_share(p_token text)
returns table(share_id uuid, shopping_list_id uuid, permission text, list_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_token is null
     or octet_length(p_token) <> 48
     or p_token !~ '^[0-9a-f]{48}$' then
    return;
  end if;

  return query
  select s.id, s.shopping_list_id, s.permission, sl.name
  from public.shopping_list_shares s
  join public.shopping_lists sl on sl.id = s.shopping_list_id
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
    and sl.is_archived = false
  limit 1;
end;
$$;

revoke all on function public.resolve_shopping_list_share(text) from public, anon, authenticated;
grant execute on function public.resolve_shopping_list_share(text) to postgres, service_role;
