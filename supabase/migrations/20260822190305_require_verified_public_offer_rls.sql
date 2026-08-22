drop policy if exists "Public read published offers" on public.offers;

create policy "Public read verified published offers"
on public.offers
for select
to anon, authenticated
using (
  (
    status = 'published'
    and is_verified = true
    and valid_to >= (timezone('Europe/Prague', now()))::date
    and valid_from <= (timezone('Europe/Prague', now()))::date + 7
  )
  or is_admin()
);
