create index if not exists shopping_lists_user_active_idx
  on public.shopping_lists(user_id, is_archived, created_at);
create index if not exists shopping_list_items_list_idx
  on public.shopping_list_items(shopping_list_id, created_at);
create index if not exists shopping_list_items_product_idx
  on public.shopping_list_items(product_id) where product_id is not null;
create index if not exists shopping_list_items_offer_idx
  on public.shopping_list_items(selected_offer_id) where selected_offer_id is not null;
create index if not exists price_alerts_user_active_idx
  on public.price_alerts(user_id, is_active, created_at desc);
create index if not exists price_alerts_product_idx
  on public.price_alerts(product_id) where product_id is not null;
create index if not exists price_alerts_store_idx
  on public.price_alerts(store_id) where store_id is not null;
create index if not exists offer_reports_user_idx
  on public.offer_reports(user_id, created_at desc) where user_id is not null;

drop policy if exists "Public create offer reports" on public.offer_reports;
drop policy if exists "Users read own offer reports" on public.offer_reports;
drop policy if exists "Admins manage offer reports" on public.offer_reports;
drop policy if exists "Admins update offer reports" on public.offer_reports;
drop policy if exists "Admins delete offer reports" on public.offer_reports;

create policy "Public create offer reports"
on public.offer_reports for insert
to anon, authenticated
with check (
  char_length(coalesce(note,'')) <= 2000
  and status = 'new'
  and (
    ((select auth.uid()) is null and user_id is null)
    or ((select auth.uid()) is not null and user_id = (select auth.uid()))
  )
);

create policy "Users read own offer reports"
on public.offer_reports for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Admins update offer reports"
on public.offer_reports for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Admins delete offer reports"
on public.offer_reports for delete
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins manage product leaflet locations" on public.public_product_leaflet_locations;
drop policy if exists "Admins insert product leaflet locations" on public.public_product_leaflet_locations;
drop policy if exists "Admins update product leaflet locations" on public.public_product_leaflet_locations;
drop policy if exists "Admins delete product leaflet locations" on public.public_product_leaflet_locations;

create policy "Admins insert product leaflet locations"
on public.public_product_leaflet_locations for insert
to authenticated
with check ((select public.is_admin()));

create policy "Admins update product leaflet locations"
on public.public_product_leaflet_locations for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Admins delete product leaflet locations"
on public.public_product_leaflet_locations for delete
to authenticated
using ((select public.is_admin()));
