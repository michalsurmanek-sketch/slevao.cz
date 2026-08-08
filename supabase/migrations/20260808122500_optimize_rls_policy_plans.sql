-- Evaluate auth.uid()/auth.jwt() once per statement instead of once per row.
-- Also remove redundant permissive SELECT policies where an existing policy already
-- grants the same read access. Permissions remain unchanged.

-- User-owned data -------------------------------------------------------------
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated
using (((select auth.uid()) = id) or public.is_admin());

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Admin read profiles" on public.profiles;

drop policy if exists "Users manage own favorites" on public.favorites;
create policy "Users manage own favorites" on public.favorites for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own shopping lists" on public.shopping_lists;
create policy "Users manage own shopping lists" on public.shopping_lists for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own shopping list items" on public.shopping_list_items;
create policy "Users manage own shopping list items" on public.shopping_list_items for all to authenticated
using (exists (
  select 1 from public.shopping_lists sl
  where sl.id = shopping_list_items.shopping_list_id
    and sl.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.shopping_lists sl
  where sl.id = shopping_list_items.shopping_list_id
    and sl.user_id = (select auth.uid())
));

drop policy if exists "Users manage own price alerts" on public.price_alerts;
create policy "Users manage own price alerts" on public.price_alerts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications for select to authenticated
using (((select auth.uid()) = user_id) or public.is_admin());

drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications for update to authenticated
using (((select auth.uid()) = user_id) or public.is_admin())
with check (((select auth.uid()) = user_id) or public.is_admin());

-- Admin notification writes: SELECT/UPDATE are already covered above.
drop policy if exists "Admin manage notifications" on public.notifications;
drop policy if exists "Admin insert notifications" on public.notifications;
create policy "Admin insert notifications" on public.notifications for insert to authenticated
with check (public.is_admin());
drop policy if exists "Admin delete notifications" on public.notifications;
create policy "Admin delete notifications" on public.notifications for delete to authenticated
using (public.is_admin());

-- Staff/automation data -------------------------------------------------------
drop policy if exists "staff read leaflet sources" on public.leaflet_sources;
drop policy if exists "staff manage leaflet sources" on public.leaflet_sources;
create policy "staff manage leaflet sources" on public.leaflet_sources for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff read leaflet imports" on public.leaflet_imports;
drop policy if exists "staff manage leaflet imports" on public.leaflet_imports;
create policy "staff manage leaflet imports" on public.leaflet_imports for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff read leaflet items" on public.leaflet_import_items;
drop policy if exists "staff manage leaflet items" on public.leaflet_import_items;
create policy "staff manage leaflet items" on public.leaflet_import_items for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff manage leaflet adapter registry" on public.leaflet_adapter_registry;
create policy "staff manage leaflet adapter registry" on public.leaflet_adapter_registry for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff manage leaflet pipeline runs" on public.leaflet_pipeline_runs;
create policy "staff manage leaflet pipeline runs" on public.leaflet_pipeline_runs for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff manage leaflet ocr runs" on public.leaflet_ocr_runs;
create policy "staff manage leaflet ocr runs" on public.leaflet_ocr_runs for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff read store product sync state" on public.store_product_sync_state;
create policy "staff read store product sync state" on public.store_product_sync_state for select to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff read expired offers" on public.expired_offer_archive;
create policy "staff read expired offers" on public.expired_offer_archive for select to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "product_image_search_runs_staff_select" on public.product_image_search_runs;
create policy "product_image_search_runs_staff_select" on public.product_image_search_runs for select to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "admins can read image automation settings" on public.product_image_automation_settings;
create policy "admins can read image automation settings" on public.product_image_automation_settings for select to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "admins can update image automation settings" on public.product_image_automation_settings;
create policy "admins can update image automation settings" on public.product_image_automation_settings for update to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) = 'admin')
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) = 'admin');

-- These tables had identical staff SELECT + ALL policies. ALL already includes SELECT.
drop policy if exists "staff read image candidates" on public.product_image_candidates;
drop policy if exists "staff manage image candidates" on public.product_image_candidates;
create policy "staff manage image candidates" on public.product_image_candidates for all to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

drop policy if exists "staff read product image library" on public.product_image_library;
-- Existing manage policy already uses an init-plan SELECT and retains identical access.

-- Product aliases are publicly readable, so staff only need explicit write policies.
drop policy if exists "staff manage product aliases" on public.product_aliases;
drop policy if exists "staff insert product aliases" on public.product_aliases;
create policy "staff insert product aliases" on public.product_aliases for insert to authenticated
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));
drop policy if exists "staff update product aliases" on public.product_aliases;
create policy "staff update product aliases" on public.product_aliases for update to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'))
with check ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));
drop policy if exists "staff delete product aliases" on public.product_aliases;
create policy "staff delete product aliases" on public.product_aliases for delete to authenticated
using ((((select auth.jwt()) -> 'app_metadata' ->> 'role')) in ('admin','editor'));

-- Public reference tables: their public SELECT policies already let admins see all
-- required rows. Split the old admin ALL policy into write-only policies to avoid
-- evaluating two permissive SELECT policies for every authenticated read.
do $$
declare
  table_name text;
  all_policy text;
begin
  foreach table_name in array array['branches','brands','categories','flyers','offers','price_history','products','stores']
  loop
    all_policy := 'Admin manage ' || case table_name
      when 'price_history' then 'price history'
      else table_name
    end;
    execute format('drop policy if exists %I on public.%I', all_policy, table_name);
    execute format('drop policy if exists %I on public.%I', 'Admin insert ' || table_name, table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', 'Admin insert ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'Admin update ' || table_name, table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', 'Admin update ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'Admin delete ' || table_name, table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', 'Admin delete ' || table_name, table_name);
  end loop;
end
$$;
