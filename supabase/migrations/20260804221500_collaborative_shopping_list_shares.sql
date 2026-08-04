create extension if not exists pgcrypto with schema extensions;

create table if not exists public.shopping_list_shares (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  token_hash text not null unique,
  permission text not null default 'edit' check (permission in ('view','edit')),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.shopping_list_shares enable row level security;
revoke all on public.shopping_list_shares from anon, authenticated;
grant select, insert, update, delete on public.shopping_list_shares to authenticated;

drop policy if exists shopping_list_shares_owner_select on public.shopping_list_shares;
create policy shopping_list_shares_owner_select on public.shopping_list_shares
for select to authenticated
using (created_by = (select auth.uid()));

drop policy if exists shopping_list_shares_owner_insert on public.shopping_list_shares;
create policy shopping_list_shares_owner_insert on public.shopping_list_shares
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.shopping_lists sl
    where sl.id = shopping_list_id and sl.user_id = (select auth.uid())
  )
);

drop policy if exists shopping_list_shares_owner_update on public.shopping_list_shares;
create policy shopping_list_shares_owner_update on public.shopping_list_shares
for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists shopping_list_shares_owner_delete on public.shopping_list_shares;
create policy shopping_list_shares_owner_delete on public.shopping_list_shares
for delete to authenticated
using (created_by = (select auth.uid()));

create index if not exists shopping_list_shares_list_active_idx
on public.shopping_list_shares(shopping_list_id, created_at desc)
where revoked_at is null;

create or replace function public.create_shopping_list_share(
  p_list_id uuid,
  p_permission text default 'edit',
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
begin
  if v_user is null then
    raise exception 'Pro sdílení se musíš přihlásit.';
  end if;
  if p_permission not in ('view','edit') then
    raise exception 'Neplatné oprávnění sdílení.';
  end if;
  if not exists (
    select 1 from public.shopping_lists
    where id = p_list_id and user_id = v_user and is_archived = false
  ) then
    raise exception 'Nákupní seznam nebyl nalezen.';
  end if;

  update public.shopping_list_shares
  set revoked_at = now()
  where shopping_list_id = p_list_id and created_by = v_user and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.shopping_list_shares(
    shopping_list_id, token_hash, permission, created_by, expires_at
  ) values (
    p_list_id, v_hash, p_permission, v_user,
    case when p_expires_days is null or p_expires_days <= 0 then null
      else now() + make_interval(days => least(p_expires_days, 365)) end
  );
  return v_token;
end;
$$;

create or replace function public.revoke_shopping_list_shares(p_list_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Pro zrušení sdílení se musíš přihlásit.';
  end if;
  update public.shopping_list_shares s
  set revoked_at = now()
  where s.shopping_list_id = p_list_id
    and s.created_by = auth.uid()
    and s.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.resolve_shopping_list_share(p_token text)
returns table (share_id uuid, shopping_list_id uuid, permission text, list_name text)
language sql
security definer
set search_path = public, extensions
as $$
  select s.id, s.shopping_list_id, s.permission, sl.name
  from public.shopping_list_shares s
  join public.shopping_lists sl on sl.id = s.shopping_list_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex')
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
    and sl.is_archived = false
  limit 1
$$;

create or replace function public.get_shared_shopping_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share record;
  v_result jsonb;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;

  update public.shopping_list_shares set last_accessed_at = now() where id = v_share.share_id;

  select jsonb_build_object(
    'list_id', v_share.shopping_list_id,
    'name', v_share.list_name,
    'permission', v_share.permission,
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'product_id', i.product_id,
        'selected_offer_id', i.selected_offer_id,
        'custom_name', i.custom_name,
        'quantity', i.quantity,
        'unit', i.unit,
        'is_completed', i.is_completed,
        'created_at', i.created_at,
        'updated_at', i.updated_at,
        'name', coalesce(p.name, i.custom_name, 'Položka'),
        'brand', p.brand,
        'quantity_text', p.quantity_text,
        'image_url', p.image_url
      ) order by i.created_at
    ) filter (where i.id is not null), '[]'::jsonb)
  ) into v_result
  from public.shopping_lists sl
  left join public.shopping_list_items i on i.shopping_list_id = sl.id
  left join public.products p on p.id = i.product_id
  where sl.id = v_share.shopping_list_id
  group by sl.id;

  return v_result;
end;
$$;

create or replace function public.mutate_shared_shopping_list(
  p_token text,
  p_action text,
  p_item_id uuid default null,
  p_product_id uuid default null,
  p_selected_offer_id uuid default null,
  p_custom_name text default null,
  p_quantity numeric default 1,
  p_unit text default 'ks',
  p_is_completed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share record;
  v_item_id uuid;
  v_name text;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;
  if v_share.permission <> 'edit' then
    raise exception 'Tento odkaz dovoluje pouze prohlížení seznamu.';
  end if;
  if p_action not in ('add','update','delete') then
    raise exception 'Neplatná operace se seznamem.';
  end if;

  if p_action = 'add' then
    v_name := nullif(left(trim(coalesce(p_custom_name,'')), 200), '');
    if p_product_id is null and v_name is null then raise exception 'Položka musí mít produkt nebo název.'; end if;
    if p_product_id is not null and not exists (select 1 from public.products where id = p_product_id) then raise exception 'Produkt nebyl nalezen.'; end if;
    if p_selected_offer_id is not null and not exists (select 1 from public.offers where id = p_selected_offer_id) then p_selected_offer_id := null; end if;

    insert into public.shopping_list_items(
      shopping_list_id, product_id, selected_offer_id, custom_name, quantity, unit, is_completed
    ) values (
      v_share.shopping_list_id, p_product_id, p_selected_offer_id,
      case when p_product_id is null then v_name else null end,
      greatest(0.01, least(coalesce(p_quantity,1),999)),
      left(coalesce(nullif(trim(p_unit),''),'ks'),30), coalesce(p_is_completed,false)
    ) returning id into v_item_id;

  elsif p_action = 'update' then
    if p_item_id is null or not exists (
      select 1 from public.shopping_list_items where id=p_item_id and shopping_list_id=v_share.shopping_list_id
    ) then raise exception 'Položka nebyla nalezena.'; end if;

    update public.shopping_list_items
    set quantity=greatest(0.01,least(coalesce(p_quantity,quantity),999)),
        unit=left(coalesce(nullif(trim(p_unit),''),unit,'ks'),30),
        is_completed=coalesce(p_is_completed,is_completed), updated_at=now()
    where id=p_item_id and shopping_list_id=v_share.shopping_list_id
    returning id into v_item_id;

  else
    if p_item_id is null then raise exception 'Chybí položka k odstranění.'; end if;
    delete from public.shopping_list_items
    where id=p_item_id and shopping_list_id=v_share.shopping_list_id
    returning id into v_item_id;
    if v_item_id is null then raise exception 'Položka nebyla nalezena.'; end if;
  end if;

  return public.get_shared_shopping_list(p_token);
end;
$$;

revoke all on function public.create_shopping_list_share(uuid,text,integer) from public;
revoke all on function public.revoke_shopping_list_shares(uuid) from public;
revoke all on function public.resolve_shopping_list_share(text) from public;
revoke all on function public.get_shared_shopping_list(text) from public;
revoke all on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean) from public;

grant execute on function public.create_shopping_list_share(uuid,text,integer) to authenticated;
grant execute on function public.revoke_shopping_list_shares(uuid) to authenticated;
grant execute on function public.get_shared_shopping_list(text) to anon, authenticated;
grant execute on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean) to anon, authenticated;