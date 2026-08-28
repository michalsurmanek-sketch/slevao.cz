create or replace function public.create_shopping_list_share(
  p_list_id uuid,
  p_permission text default 'edit'::text,
  p_expires_days integer default 30
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_hash text;
  v_user uuid := auth.uid();
  v_expires_days integer := coalesce(p_expires_days, 30);
begin
  if v_user is null then
    raise exception 'Pro sdílení se musíš přihlásit.';
  end if;

  if p_permission not in ('view','edit') then
    raise exception 'Neplatné oprávnění sdílení.';
  end if;

  if v_expires_days < 1 or v_expires_days > 365 then
    raise exception 'Platnost sdíleného odkazu musí být 1 až 365 dnů.';
  end if;

  perform 1
  from public.shopping_lists
  where id = p_list_id
    and user_id = v_user
    and is_archived = false
  for update;

  if not found then
    raise exception 'Nákupní seznam nebyl nalezen.';
  end if;

  update public.shopping_list_shares
  set revoked_at = now()
  where shopping_list_id = p_list_id
    and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.shopping_list_shares(
    shopping_list_id, token_hash, permission, created_by, expires_at
  ) values (
    p_list_id,
    v_hash,
    p_permission,
    v_user,
    now() + make_interval(days => v_expires_days)
  );

  return v_token;
end;
$$;

revoke all on function public.create_shopping_list_share(uuid,text,integer) from public, anon;
grant execute on function public.create_shopping_list_share(uuid,text,integer) to authenticated, service_role;
