drop policy if exists product_favorites_update_own on public.product_favorites;

create policy product_favorites_update_own
on public.product_favorites
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
