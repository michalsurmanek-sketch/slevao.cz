create table if not exists public.shopping_list_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shopping_list_id uuid references public.shopping_lists(id) on delete set null,
  name text not null default 'Dokončený nákup',
  planned_total numeric(12,2) not null default 0 check (planned_total >= 0),
  reference_total numeric(12,2) not null default 0 check (reference_total >= 0),
  savings numeric(12,2) not null default 0 check (savings >= 0),
  budget numeric(12,2) check (budget is null or budget >= 0),
  stores_count integer not null default 0 check (stores_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  completed_at timestamptz not null default now()
);

alter table public.shopping_list_purchases enable row level security;
revoke all on public.shopping_list_purchases from anon;
grant select,insert,delete on public.shopping_list_purchases to authenticated;

drop policy if exists shopping_list_purchases_owner_select on public.shopping_list_purchases;
create policy shopping_list_purchases_owner_select on public.shopping_list_purchases
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists shopping_list_purchases_owner_insert on public.shopping_list_purchases;
create policy shopping_list_purchases_owner_insert on public.shopping_list_purchases
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists shopping_list_purchases_owner_delete on public.shopping_list_purchases;
create policy shopping_list_purchases_owner_delete on public.shopping_list_purchases
for delete to authenticated
using (user_id = (select auth.uid()));

create index if not exists shopping_list_purchases_user_completed_idx
on public.shopping_list_purchases(user_id, completed_at desc);

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
    'budget', sl.budget,
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

revoke execute on function public.get_shared_shopping_list(text) from public;
grant execute on function public.get_shared_shopping_list(text) to anon, authenticated;