-- Slevao.cz: bezpečná fronta kandidátních produktových fotografií.
-- Obrázek se na web dostane pouze po schválení. Automatické zdroje mohou kandidáty
-- navrhovat, ale nikdy nesmí samy přepsat veřejný produktový obrázek.

create table if not exists public.product_image_candidates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  source_url text,
  source_domain text,
  source_type text not null default 'unknown'
    check (source_type in ('manufacturer','retailer','official_catalog','barcode_database','manual','unknown')),
  width integer,
  height integer,
  file_size_bytes bigint,
  mime_type text,
  quality_score smallint not null default 0 check (quality_score between 0 and 100),
  match_score numeric(5,4) check (match_score is null or (match_score >= 0 and match_score <= 1)),
  has_clean_background boolean,
  has_text_overlay boolean,
  has_price_overlay boolean,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','invalid')),
  rejection_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_image_candidates_unique_url_idx
  on public.product_image_candidates(product_id, image_url);
create index if not exists product_image_candidates_review_idx
  on public.product_image_candidates(status, quality_score desc, created_at);
create index if not exists product_image_candidates_product_idx
  on public.product_image_candidates(product_id, status);

create or replace function public.touch_product_image_candidate()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_image_candidates_touch_trigger on public.product_image_candidates;
create trigger product_image_candidates_touch_trigger
before update on public.product_image_candidates
for each row execute function public.touch_product_image_candidate();

create or replace function public.apply_approved_product_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  -- Minimální bezpečnostní podmínky. Ruční kandidát může postrádat technická metadata,
  -- ale automatický kandidát nesmí mít cenovku, text ani nízké skóre.
  if new.source_type <> 'manual' then
    if coalesce(new.quality_score, 0) < 70 then
      raise exception 'Kandidát nemá dostatečnou kvalitu (minimum 70).';
    end if;
    if coalesce(new.has_text_overlay, false) or coalesce(new.has_price_overlay, false) then
      raise exception 'Kandidát obsahuje text nebo cenu.';
    end if;
    if new.width is not null and new.width < 500 then
      raise exception 'Kandidát je příliš úzký (minimum 500 px).';
    end if;
    if new.height is not null and new.height < 500 then
      raise exception 'Kandidát je příliš nízký (minimum 500 px).';
    end if;
  end if;

  update public.products
  set image_url = new.image_url,
      image_source = coalesce(new.source_url, new.source_domain, new.source_type),
      image_quality = greatest(coalesce(new.quality_score, 0), 70),
      image_verified = true,
      image_checked_at = now()
  where id = new.product_id;

  update public.offers
  set image_url = new.image_url
  where product_id = new.product_id
    and status = 'published';

  update public.leaflet_import_items
  set image_url = new.image_url
  where product_id = new.product_id
    and status = 'published';

  -- U jednoho produktu je vždy právě jeden schválený hlavní obrázek.
  update public.product_image_candidates
  set status = 'rejected',
      rejection_reason = 'Nahrazeno nově schváleným hlavním obrázkem',
      reviewed_at = now()
  where product_id = new.product_id
    and id <> new.id
    and status = 'approved';

  return new;
end;
$$;

drop trigger if exists product_image_candidates_apply_trigger on public.product_image_candidates;
create trigger product_image_candidates_apply_trigger
after update of status on public.product_image_candidates
for each row execute function public.apply_approved_product_image();

alter table public.product_image_candidates enable row level security;

drop policy if exists "staff read image candidates" on public.product_image_candidates;
create policy "staff read image candidates"
on public.product_image_candidates for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

drop policy if exists "staff manage image candidates" on public.product_image_candidates;
create policy "staff manage image candidates"
on public.product_image_candidates for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'))
with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

-- Přehled produktů, kterým kvalitní fotografie stále chybí.
create or replace view public.products_missing_verified_images as
select
  p.id,
  p.name,
  p.brand,
  p.ean,
  p.quantity_text,
  count(distinct o.id) filter (where o.status = 'published') as active_offer_count,
  count(distinct o.store_id) filter (where o.status = 'published') as active_store_count,
  max(o.published_at) as last_offer_at
from public.products p
left join public.offers o on o.product_id = p.id
where p.image_url is null
   or p.image_verified = false
   or coalesce(p.image_quality, 0) < 70
group by p.id, p.name, p.brand, p.ean, p.quantity_text;
