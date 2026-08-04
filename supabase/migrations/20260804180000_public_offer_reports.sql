create table if not exists public.offer_reports (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.offers(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  report_type text not null check (report_type in ('wrong_price','wrong_image','wrong_quantity','expired','unavailable','other')),
  note text,
  page_url text,
  status text not null default 'new' check (status in ('new','reviewing','resolved','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.offer_reports enable row level security;

drop policy if exists "Public create offer reports" on public.offer_reports;
create policy "Public create offer reports"
on public.offer_reports for insert
to anon, authenticated
with check (char_length(coalesce(note,'')) <= 2000 and status = 'new');

drop policy if exists "Users read own offer reports" on public.offer_reports;
create policy "Users read own offer reports"
on public.offer_reports for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins manage offer reports" on public.offer_reports;
create policy "Admins manage offer reports"
on public.offer_reports for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create index if not exists offer_reports_status_created_idx on public.offer_reports(status, created_at desc);
create index if not exists offer_reports_offer_idx on public.offer_reports(offer_id) where offer_id is not null;
create index if not exists offer_reports_product_idx on public.offer_reports(product_id) where product_id is not null;
