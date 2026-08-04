-- Slevao.cz: trvalá knihovna schválených produktových fotografií.
-- Jednou schválená fotografie se bezpečně použije u dalších nabídek stejného produktu.

create table if not exists public.product_image_library (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  source_url text,
  source_domain text,
  source_type text not null default 'unknown',
  image_hash text,
  quality_score smallint not null default 70 check (quality_score between 0 and 100),
  approved_candidate_id uuid references public.product_image_candidates(id) on delete set null,
  is_active boolean not null default true,
  usage_count bigint not null default 0,
  last_used_at timestamptz,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, image_url)
);

create unique index if not exists product_image_library_one_active_idx
  on public.product_image_library(product_id)
  where is_active;
create index if not exists product_image_library_product_idx
  on public.product_image_library(product_id, is_active, quality_score desc);
create index if not exists product_image_library_hash_idx
  on public.product_image_library(image_hash)
  where image_hash is not null and image_hash <> '';

alter table public.product_image_library enable row level security;

drop policy if exists "staff read product image library" on public.product_image_library;
create policy "staff read product image library"
on public.product_image_library for select
to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

drop policy if exists "staff manage product image library" on public.product_image_library;
create policy "staff manage product image library"
on public.product_image_library for all
to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'))
with check ((select auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','editor'));

create or replace function public.touch_product_image_library()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_image_library_touch_trigger on public.product_image_library;
create trigger product_image_library_touch_trigger
before update on public.product_image_library
for each row execute function public.touch_product_image_library();

create or replace function public.active_verified_product_image(p_product_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select l.image_url
      from public.product_image_library l
      where l.product_id = p_product_id
        and l.is_active = true
        and l.quality_score >= 70
      order by l.quality_score desc, l.approved_at desc
      limit 1
    ),
    (
      select p.image_url
      from public.products p
      where p.id = p_product_id
        and p.image_verified = true
        and coalesce(p.image_quality, 0) >= 70
        and p.image_url is not null
        and p.image_url <> ''
        and p.image_url not like '%/leaflet-crops/%'
    )
  );
$$;

create or replace function public.product_match_brand_compatible(left_brand text, right_brand text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select nullif(public.normalize_product_name(left_brand), '') is null
      or nullif(public.normalize_product_name(right_brand), '') is null
      or public.normalize_product_name(left_brand) = public.normalize_product_name(right_brand);
$$;

create or replace function public.product_match_quantity_compatible(left_quantity text, right_quantity text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select nullif(public.normalize_product_name(left_quantity), '') is null
      or nullif(public.normalize_product_name(right_quantity), '') is null
      or regexp_replace(lower(left_quantity), '[^0-9a-z]+', '', 'g') = regexp_replace(lower(right_quantity), '[^0-9a-z]+', '', 'g');
$$;

create or replace function public.resolve_product_for_import(
  p_title text,
  p_brand text default null,
  p_quantity text default null,
  p_ean text default null,
  p_store_id uuid default null
)
returns table(
  matched_product_id uuid,
  matched_image_url text,
  match_type text,
  match_score numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  normalized_title text := public.normalize_product_name(p_title);
  clean_ean text := nullif(regexp_replace(coalesce(p_ean, ''), '\D', '', 'g'), '');
  candidate_count integer := 0;
  image_candidate_count integer := 0;
begin
  if clean_ean is not null and length(clean_ean) between 8 and 14 then
    return query
    select p.id, public.active_verified_product_image(p.id), 'ean_exact'::text, 1.0000::numeric
    from public.products p
    where regexp_replace(coalesce(p.ean, ''), '\D', '', 'g') = clean_ean
    limit 1;
    if found then return; end if;
  end if;

  if normalized_title = '' then return; end if;

  if p_store_id is not null then
    select count(distinct p.id)
    into candidate_count
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where a.normalized_alias = normalized_title
      and a.source_store_id = p_store_id
      and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
      and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity);

    if candidate_count = 1 then
      return query
      select p.id, public.active_verified_product_image(p.id), 'store_alias_exact'::text, 0.9950::numeric
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where a.normalized_alias = normalized_title
        and a.source_store_id = p_store_id
        and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
        and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity)
      order by a.confidence desc, p.id
      limit 1;
      return;
    end if;
  end if;

  select count(distinct p.id),
         count(distinct p.id) filter (where public.active_verified_product_image(p.id) is not null)
  into candidate_count, image_candidate_count
  from public.product_aliases a
  join public.products p on p.id = a.product_id
  where a.normalized_alias = normalized_title
    and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
    and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity);

  if candidate_count = 1 or (candidate_count > 1 and image_candidate_count = 1) then
    return query
    select p.id, public.active_verified_product_image(p.id), 'alias_exact'::text,
           case when candidate_count = 1 then 0.9850::numeric else 0.9650::numeric end
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where a.normalized_alias = normalized_title
      and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
      and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity)
      and (candidate_count = 1 or public.active_verified_product_image(p.id) is not null)
    order by (public.active_verified_product_image(p.id) is not null) desc, a.confidence desc, p.id
    limit 1;
    return;
  end if;

  select count(*),
         count(*) filter (where public.active_verified_product_image(p.id) is not null)
  into candidate_count, image_candidate_count
  from public.products p
  where p.normalized_name = normalized_title
    and public.product_match_brand_compatible(p.brand, p_brand)
    and public.product_match_quantity_compatible(p.quantity_text, p_quantity);

  if candidate_count = 1 or (candidate_count > 1 and image_candidate_count = 1) then
    return query
    select p.id, public.active_verified_product_image(p.id), 'name_exact'::text,
           case when candidate_count = 1 then 0.9750::numeric else 0.9550::numeric end
    from public.products p
    where p.normalized_name = normalized_title
      and public.product_match_brand_compatible(p.brand, p_brand)
      and public.product_match_quantity_compatible(p.quantity_text, p_quantity)
      and (candidate_count = 1 or public.active_verified_product_image(p.id) is not null)
    order by (public.active_verified_product_image(p.id) is not null) desc, p.id
    limit 1;
  end if;
end;
$$;

create or replace function public.apply_approved_product_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  final_source text;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

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

  final_source := coalesce(new.source_url, new.source_domain, new.source_type);

  update public.product_image_library
  set is_active = false
  where product_id = new.product_id and is_active = true;

  insert into public.product_image_library(
    product_id, image_url, source_url, source_domain, source_type,
    quality_score, approved_candidate_id, is_active, approved_at
  ) values (
    new.product_id, new.image_url, new.source_url, new.source_domain, new.source_type,
    greatest(coalesce(new.quality_score, 0), 70), new.id, true, coalesce(new.reviewed_at, now())
  )
  on conflict (product_id, image_url)
  do update set
    source_url = coalesce(excluded.source_url, product_image_library.source_url),
    source_domain = coalesce(excluded.source_domain, product_image_library.source_domain),
    source_type = excluded.source_type,
    quality_score = greatest(product_image_library.quality_score, excluded.quality_score),
    approved_candidate_id = excluded.approved_candidate_id,
    is_active = true,
    approved_at = excluded.approved_at,
    updated_at = now();

  update public.products
  set image_url = new.image_url,
      image_source = final_source,
      image_quality = greatest(coalesce(new.quality_score, 0), 70),
      image_verified = true,
      image_checked_at = now()
  where id = new.product_id;

  update public.offers
  set image_url = new.image_url
  where product_id = new.product_id;

  update public.leaflet_import_items
  set image_url = new.image_url
  where product_id = new.product_id;

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

create or replace function public.apply_library_image_to_offer()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved record;
  library_image text;
begin
  select * into resolved
  from public.resolve_product_for_import(new.title, null, null, null, new.store_id)
  limit 1;

  if resolved.matched_product_id is not null then
    new.product_id := resolved.matched_product_id;
  end if;

  if new.product_id is not null then
    library_image := public.active_verified_product_image(new.product_id);
    if library_image is not null then
      new.image_url := library_image;
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_offers_apply_library_image_trigger on public.offers;
create trigger zz_offers_apply_library_image_trigger
before insert or update of title, product_id, image_url, store_id on public.offers
for each row execute function public.apply_library_image_to_offer();

create or replace function public.apply_library_image_to_leaflet_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  library_image text;
begin
  if new.product_id is not null then
    library_image := public.active_verified_product_image(new.product_id);
    if library_image is not null then
      new.image_url := library_image;
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_leaflet_items_apply_library_image_trigger on public.leaflet_import_items;
create trigger zz_leaflet_items_apply_library_image_trigger
before insert or update of product_id, image_url on public.leaflet_import_items
for each row execute function public.apply_library_image_to_leaflet_item();

create or replace function public.remember_offer_product_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_title text;
  product_brand text;
  product_quantity text;
begin
  if new.product_id is null then return new; end if;

  normalized_title := public.normalize_product_name(new.title);
  if normalized_title = '' then return new; end if;

  select p.brand, p.quantity_text
  into product_brand, product_quantity
  from public.products p
  where p.id = new.product_id;

  insert into public.product_aliases(
    product_id, alias, normalized_alias, brand, quantity_text,
    source_store_id, confidence
  ) values (
    new.product_id, new.title, normalized_title, product_brand, product_quantity,
    new.store_id, 1
  )
  on conflict (product_id, normalized_alias)
  do update set
    alias = excluded.alias,
    brand = coalesce(excluded.brand, product_aliases.brand),
    quantity_text = coalesce(excluded.quantity_text, product_aliases.quantity_text),
    source_store_id = coalesce(excluded.source_store_id, product_aliases.source_store_id),
    confidence = greatest(product_aliases.confidence, excluded.confidence),
    updated_at = now();

  return new;
end;
$$;

insert into public.product_image_library(
  product_id, image_url, source_url, source_type, quality_score,
  is_active, usage_count, last_used_at, approved_at
)
select p.id, p.image_url, p.image_source, 'legacy_verified', greatest(p.image_quality, 70),
       true,
       (select count(*) from public.offers o where o.product_id = p.id and o.image_url = p.image_url),
       p.image_checked_at,
       coalesce(p.image_checked_at, p.updated_at, now())
from public.products p
where p.image_verified = true
  and coalesce(p.image_quality, 0) >= 70
  and p.image_url is not null
  and p.image_url <> ''
  and p.image_url not like '%/leaflet-crops/%'
on conflict (product_id, image_url)
do update set
  source_url = coalesce(excluded.source_url, product_image_library.source_url),
  quality_score = greatest(product_image_library.quality_score, excluded.quality_score),
  is_active = true,
  usage_count = greatest(product_image_library.usage_count, excluded.usage_count),
  last_used_at = greatest(product_image_library.last_used_at, excluded.last_used_at),
  updated_at = now();

update public.offers o
set image_url = public.active_verified_product_image(o.product_id)
where o.product_id is not null
  and public.active_verified_product_image(o.product_id) is not null
  and o.image_url is distinct from public.active_verified_product_image(o.product_id);

update public.leaflet_import_items li
set image_url = public.active_verified_product_image(li.product_id)
where li.product_id is not null
  and public.active_verified_product_image(li.product_id) is not null
  and li.image_url is distinct from public.active_verified_product_image(li.product_id);

revoke all on function public.active_verified_product_image(uuid) from public, anon, authenticated;
grant execute on function public.active_verified_product_image(uuid) to service_role;
revoke all on function public.resolve_product_for_import(text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.resolve_product_for_import(text,text,text,text,uuid) to service_role;
revoke all on function public.apply_approved_product_image() from public, anon, authenticated;
revoke all on function public.apply_library_image_to_offer() from public, anon, authenticated;
revoke all on function public.apply_library_image_to_leaflet_item() from public, anon, authenticated;
revoke all on function public.remember_offer_product_alias() from public, anon, authenticated;
revoke all on function public.touch_product_image_library() from public, anon, authenticated;
