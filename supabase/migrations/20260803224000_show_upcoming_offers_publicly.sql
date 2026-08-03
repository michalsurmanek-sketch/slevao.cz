drop policy if exists "Public read published offers" on public.offers;
create policy "Public read published offers"
on public.offers
for select
to anon, authenticated
using (
  (
    status = 'published'
    and valid_to >= current_date
    and valid_from <= current_date + 7
  )
  or is_admin()
);
