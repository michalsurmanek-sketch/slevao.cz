-- SLEVAO serves Czech promotions. Supabase/Postgres normally runs in UTC, which
-- makes CURRENT_DATE lag Czech local date by 1-2 hours after midnight.
-- Keep timestamps in UTC, but evaluate the public offer-validity calendar in Prague.

drop policy if exists "Public read published offers" on public.offers;
create policy "Public read published offers"
on public.offers for select
to anon, authenticated
using (
  (
    status = 'published'
    and valid_to >= (now() at time zone 'Europe/Prague')::date
    and valid_from <= ((now() at time zone 'Europe/Prague')::date + 7)
  )
  or public.is_admin()
);
