create table if not exists public.product_equivalences (
  id uuid primary key default gen_random_uuid(),
  product_id_a uuid not null references public.products(id) on delete cascade,
  product_id_b uuid not null references public.products(id) on delete cascade,
  match_method text not null,
  confidence numeric(5,4) not null default 1.0000,
  evidence jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_equivalences_distinct_products check (product_id_a <> product_id_b),
  constraint product_equivalences_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint product_equivalences_method_check check (match_method in ('curated_brand_quantity','manual_review','external_identity'))
);

create unique index if not exists product_equivalences_pair_uidx
on public.product_equivalences (
  least(product_id_a, product_id_b),
  greatest(product_id_a, product_id_b)
);

create index if not exists product_equivalences_a_idx
on public.product_equivalences(product_id_a)
where is_active = true;

create index if not exists product_equivalences_b_idx
on public.product_equivalences(product_id_b)
where is_active = true;

alter table public.product_equivalences enable row level security;

drop policy if exists product_equivalences_public_read on public.product_equivalences;
create policy product_equivalences_public_read
on public.product_equivalences
for select
to anon, authenticated
using (is_active = true and confidence >= 0.99);

grant select on public.product_equivalences to anon, authenticated;
revoke insert, update, delete on public.product_equivalences from anon, authenticated;

with kofola_candidates as (
  select p.id,p.name,p.normalized_name,p.brand,p.quantity_text
  from public.products p
  where p.is_verified = true
    and public.normalize_product_name(p.brand) = 'kofola'
    and public.product_quantity_key(coalesce(p.quantity_text,p.name)) = '2l'
    and p.normalized_name in ('kofola','kofola original 2 l')
), guarded as (
  select array_agg(id order by normalized_name) ids,
         count(*) as candidate_count
  from kofola_candidates
)
insert into public.product_equivalences(product_id_a,product_id_b,match_method,confidence,evidence)
select ids[1],ids[2],'curated_brand_quantity',1.0000,
       jsonb_build_object(
         'brand','Kofola',
         'quantity','2 l',
         'reason','Verified master products represent Kofola 2 l; one source omits the Original variant word.',
         'reviewed_at',now()
       )
from guarded
where candidate_count = 2
on conflict do nothing;
