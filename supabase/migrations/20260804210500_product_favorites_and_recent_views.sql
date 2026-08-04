create table if not exists public.product_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.recently_viewed_products (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1 check (view_count > 0),
  primary key (user_id, product_id)
);

alter table public.product_favorites enable row level security;
alter table public.recently_viewed_products enable row level security;

revoke all on public.product_favorites from anon;
revoke all on public.recently_viewed_products from anon;
grant select, insert, update, delete on public.product_favorites to authenticated;
grant select, insert, update, delete on public.recently_viewed_products to authenticated;

drop policy if exists product_favorites_select_own on public.product_favorites;
create policy product_favorites_select_own on public.product_favorites
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists product_favorites_insert_own on public.product_favorites;
create policy product_favorites_insert_own on public.product_favorites
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists product_favorites_delete_own on public.product_favorites;
create policy product_favorites_delete_own on public.product_favorites
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists recent_products_select_own on public.recently_viewed_products;
create policy recent_products_select_own on public.recently_viewed_products
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists recent_products_insert_own on public.recently_viewed_products;
create policy recent_products_insert_own on public.recently_viewed_products
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists recent_products_update_own on public.recently_viewed_products;
create policy recent_products_update_own on public.recently_viewed_products
for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists recent_products_delete_own on public.recently_viewed_products;
create policy recent_products_delete_own on public.recently_viewed_products
for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists product_favorites_product_idx on public.product_favorites(product_id, created_at desc);
create index if not exists product_favorites_user_created_idx on public.product_favorites(user_id, created_at desc);
create index if not exists recent_products_user_viewed_idx on public.recently_viewed_products(user_id, last_viewed_at desc);

insert into public.product_favorites(user_id, product_id, created_at)
select distinct f.user_id, o.product_id, min(f.created_at)
from public.favorites f
join public.offers o on o.id = f.offer_id
where o.product_id is not null
group by f.user_id, o.product_id
on conflict (user_id, product_id) do nothing;