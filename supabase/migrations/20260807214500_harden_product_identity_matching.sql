-- Slevao.cz: ochrana centrálního katalogu před falešným slučováním produktů.
-- Zachovává existující data, ale automaticky důvěřuje jen přesným identitám se
-- shodnou gramáží / značkou. Starý fuzzy Edge cron je do nasazení nové verze vypnutý.

create or replace function public.product_quantity_key(value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  source_text text := lower(unaccent(coalesce(value, '')));
  parts text[];
begin
  parts := regexp_match(source_text, '([0-9]+)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|g|mg|l|ml|cl|ks)');
  if parts is not null then
    return parts[1] || 'x' || replace(parts[2], ',', '.') || parts[3];
  end if;

  parts := regexp_match(source_text, '([0-9]+(?:[.,][0-9]+)?)\s*(kg|g|mg|l|ml|cl|ks)');
  if parts is not null then
    return replace(parts[1], ',', '.') || parts[2];
  end if;

  return null;
end;
$$;

create or replace function public.product_label_is_specific(value text)
returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  normalized_value text := public.normalize_product_name(value);
begin
  if normalized_value = '' or normalized_value ~ '^[0-9]+$' then
    return false;
  end if;

  if normalized_value = any(array[
    'cena','akce','sleva','vybrane druhy','dle nabidky','s klubem',
    'club','original','mini','selection','cool'
  ]) then
    return false;
  end if;

  return normalized_value ~ '[a-z]{3,}';
end;
$$;

create or replace function public.product_identity_match_safe(
  offer_title text,
  source_title text,
  source_brand text,
  source_quantity text
)
returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  offer_name text := public.normalize_product_name(offer_title);
  candidate_name text := public.normalize_product_name(source_title);
  offer_quantity text := public.product_quantity_key(offer_title);
  candidate_quantity text := public.product_quantity_key(coalesce(source_quantity, source_title));
  candidate_brand text := public.normalize_product_name(source_brand);
  token_count integer := 0;
begin
  if offer_name = '' or candidate_name = '' or offer_name <> candidate_name then
    return false;
  end if;

  if not public.product_label_is_specific(offer_title)
     or not public.product_label_is_specific(source_title) then
    return false;
  end if;

  if (offer_quantity is null) <> (candidate_quantity is null) then
    return false;
  end if;

  if offer_quantity is not null and offer_quantity <> candidate_quantity then
    return false;
  end if;

  if candidate_brand <> '' and position(candidate_brand in offer_name) = 0 then
    return false;
  end if;

  if offer_quantity is null and candidate_brand = '' then
    token_count := cardinality(regexp_split_to_array(offer_name, '\s+'));
    if token_count < 2 then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create index if not exists product_aliases_identity_signal_idx
on public.product_aliases(normalized_alias, confidence desc)
where confidence >= 0.92
  and (brand is not null or quantity_text is not null);

create or replace function public.match_offer_to_product_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_title text;
  matched_product_id uuid;
  matched_image_url text;
  candidate_count integer := 0;
  previous_product_id uuid;
  previous_image_url text;
begin
  normalized_title := public.normalize_product_name(new.title);
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else new.product_id end;
  previous_image_url := case when tg_op = 'UPDATE' then old.image_url else new.image_url end;

  if normalized_title = '' or not public.product_label_is_specific(new.title) then
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      new.product_id := old.product_id;
      new.image_url := old.image_url;
      new.catalog_match_status := 'needs_review';
      new.catalog_match_score := null;
      new.catalog_checked_at := now();
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
    return new;
  end if;

  with candidates as (
    select distinct
      p.id,
      case
        when p.image_url is not null
          and p.image_verified = true
          and coalesce(p.image_quality, 0) >= 70
          and p.image_url not like '%/leaflet-crops/%'
        then p.image_url
        else null
      end as approved_image
    from public.products p
    left join public.product_aliases a
      on a.product_id = p.id
     and a.normalized_alias = normalized_title
     and a.confidence >= 0.92
     and (a.brand is not null or a.quantity_text is not null)
    where (
      p.normalized_name = normalized_title
      and public.product_identity_match_safe(new.title, p.name, p.brand, p.quantity_text)
    ) or (
      a.id is not null
      and public.product_identity_match_safe(
        new.title,
        a.alias,
        coalesce(a.brand, p.brand),
        coalesce(a.quantity_text, p.quantity_text)
      )
    )
  ), ranked as (
    select *, count(*) over () as total
    from candidates
    order by (approved_image is not null) desc, id
  )
  select id, approved_image, total
    into matched_product_id, matched_image_url, candidate_count
  from ranked
  limit 1;

  if candidate_count = 1 then
    new.product_id := matched_product_id;
    if matched_image_url is not null then
      new.image_url := matched_image_url;
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
    new.catalog_match_status := case
      when previous_product_id = matched_product_id then 'retained'
      else 'matched'
    end;
    new.catalog_match_score := 1;
    new.catalog_checked_at := now();
  else
    -- Nejednoznačný nebo nedostatečně popsaný kandidát nesmí změnit product_id.
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      new.product_id := old.product_id;
      new.image_url := old.image_url;
      new.catalog_match_status := 'needs_review';
      new.catalog_match_score := null;
      new.catalog_checked_at := now();
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists offers_match_product_master_trigger on public.offers;
drop trigger if exists zz_offers_match_product_master_trigger on public.offers;
create trigger zz_offers_match_product_master_trigger
before insert or update of title, product_id, image_url
on public.offers
for each row
execute function public.match_offer_to_product_master();

create or replace function public.remember_offer_product_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_title text;
  offer_quantity text;
  product_quantity text;
  product_brand text;
  product_name text;
  alias_confidence numeric(5,4);
begin
  if new.product_id is null then
    return new;
  end if;

  normalized_title := public.normalize_product_name(new.title);
  if normalized_title = '' or not public.product_label_is_specific(new.title) then
    return new;
  end if;

  select p.name, p.brand, p.quantity_text
    into product_name, product_brand, product_quantity
  from public.products p
  where p.id = new.product_id;

  if product_name is null then
    return new;
  end if;

  offer_quantity := public.product_quantity_key(new.title);
  product_quantity := public.product_quantity_key(coalesce(product_quantity, product_name));

  if not public.product_identity_match_safe(new.title, product_name, product_brand, product_quantity) then
    return new;
  end if;

  -- Alias potřebuje vedle názvu ještě alespoň jeden identifikační signál.
  if offer_quantity is null and coalesce(public.normalize_product_name(product_brand), '') = '' then
    return new;
  end if;

  alias_confidence := case
    when offer_quantity is not null and coalesce(public.normalize_product_name(product_brand), '') <> '' then 1.0000
    else 0.9800
  end;

  insert into public.product_aliases(
    product_id,
    alias,
    normalized_alias,
    brand,
    quantity_text,
    source_store_id,
    confidence
  ) values (
    new.product_id,
    new.title,
    normalized_title,
    nullif(product_brand, ''),
    coalesce(offer_quantity, nullif(product_quantity, '')),
    new.store_id,
    alias_confidence
  )
  on conflict (product_id, normalized_alias)
  do update set
    alias = excluded.alias,
    brand = coalesce(product_aliases.brand, excluded.brand),
    quantity_text = coalesce(product_aliases.quantity_text, excluded.quantity_text),
    source_store_id = coalesce(excluded.source_store_id, product_aliases.source_store_id),
    confidence = greatest(product_aliases.confidence, excluded.confidence),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists offers_remember_product_alias_trigger on public.offers;
create trigger offers_remember_product_alias_trigger
after insert or update of title, product_id
on public.offers
for each row
execute function public.remember_offer_product_alias();

-- Do nasazení zpřísněné Edge verze nepouštět starý fuzzy matcher automaticky.
do $$
begin
  if exists(select 1 from cron.job where jobname = 'product-catalog-match-queue') then
    perform cron.unschedule('product-catalog-match-queue');
  end if;
end;
$$;

-- Karanténa pouze pro aktuální mezireťezcové produkty, kde jedna nabídka gramáž
-- uvádí a druhá ji pod stejným product_id neuvádí. Vazby nemažeme.
with multi_store as (
  select
    product_id,
    count(*) filter (
      where title ~* '([0-9]+(?:[.,][0-9]+)?\s*(kg|g|mg|l|ml|cl|ks))'
    ) as with_quantity,
    count(*) filter (
      where not (title ~* '([0-9]+(?:[.,][0-9]+)?\s*(kg|g|mg|l|ml|cl|ks))')
    ) as without_quantity
  from public.offers
  where status = 'published'
    and valid_from <= current_date
    and valid_to >= current_date
    and product_id is not null
  group by product_id
  having count(distinct store_id) >= 2
), suspicious as (
  select product_id
  from multi_store
  where with_quantity > 0 and without_quantity > 0
)
update public.offers o
set catalog_match_status = 'needs_review',
    catalog_match_score = null,
    catalog_checked_at = now()
where o.product_id in (select product_id from suspicious)
  and o.status = 'published'
  and o.valid_from <= current_date
  and o.valid_to >= current_date;

with multi_store as (
  select
    product_id,
    count(*) filter (
      where title ~* '([0-9]+(?:[.,][0-9]+)?\s*(kg|g|mg|l|ml|cl|ks))'
    ) as with_quantity,
    count(*) filter (
      where not (title ~* '([0-9]+(?:[.,][0-9]+)?\s*(kg|g|mg|l|ml|cl|ks))')
    ) as without_quantity
  from public.offers
  where status = 'published'
    and valid_from <= current_date
    and valid_to >= current_date
    and product_id is not null
  group by product_id
  having count(distinct store_id) >= 2
), suspicious as (
  select product_id
  from multi_store
  where with_quantity > 0 and without_quantity > 0
)
update public.product_aliases a
set confidence = least(a.confidence, 0.6000),
    updated_at = now()
where a.product_id in (select product_id from suspicious)
  and a.source_store_id is not null;
