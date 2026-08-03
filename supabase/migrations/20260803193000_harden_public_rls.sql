-- Slevao.cz: sjednocené RLS politiky pro veřejný web a administraci.
-- Veřejnost vidí pouze aktivní obchody, aktivní kategorie a právě platné publikované nabídky.

alter table public.offers enable row level security;
alter table public.stores enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_aliases enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('offers', 'stores', 'categories', 'products', 'product_aliases')
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end
$$;

create policy "public read active stores"
on public.stores for select
to anon, authenticated
using (is_active = true);

create policy "staff manage stores"
on public.stores for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create policy "public read active categories"
on public.categories for select
to anon, authenticated
using (is_active = true);

create policy "staff manage categories"
on public.categories for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create policy "public read current published offers"
on public.offers for select
to anon, authenticated
using (
  status = 'published'
  and valid_from <= current_date
  and valid_to >= current_date
  and exists (
    select 1
    from public.stores s
    where s.id = offers.store_id
      and s.is_active = true
  )
);

create policy "staff manage offers"
on public.offers for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create policy "public read products in current offers"
on public.products for select
to anon, authenticated
using (
  exists (
    select 1
    from public.offers o
    join public.stores s on s.id = o.store_id
    where o.product_id = products.id
      and o.status = 'published'
      and o.valid_from <= current_date
      and o.valid_to >= current_date
      and s.is_active = true
  )
);

create policy "staff manage products"
on public.products for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create policy "staff read product aliases"
on public.product_aliases for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create policy "staff manage product aliases"
on public.product_aliases for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

grant select on public.offers, public.stores, public.categories, public.products to anon, authenticated;
grant insert, update, delete on public.offers, public.stores, public.categories, public.products, public.product_aliases to authenticated;
grant select on public.product_aliases to authenticated;
