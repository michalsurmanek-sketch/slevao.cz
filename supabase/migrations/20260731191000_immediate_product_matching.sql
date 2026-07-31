-- Slevao.cz: okamžité bezpečné párování nových nabídek na centrální katalog.
-- Přesné shody se vyřeší přímo při INSERT/UPDATE nabídky. Fuzzy shody dále řeší
-- Edge Function match-product-catalog, aby se databázový trigger nikdy nedopustil
-- riskantního sloučení podobných, ale odlišných výrobků.

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
begin
  normalized_title := public.normalize_product_name(new.title);
  if normalized_title = '' then
    return new;
  end if;

  with candidates as (
    select distinct p.id,
      case
        when p.image_url is not null
          and p.image_verified = true
          and coalesce(p.image_quality, 0) >= 70
          and p.image_url not like '%/leaflet-crops/%'
        then p.image_url
        else null
      end as approved_image,
      case
        when p.image_url is not null
          and p.image_verified = true
          and coalesce(p.image_quality, 0) >= 70
          and p.image_url not like '%/leaflet-crops/%'
        then 1 else 0
      end as has_approved_image
    from public.products p
    left join public.product_aliases a on a.product_id = p.id
    where p.normalized_name = normalized_title
       or a.normalized_alias = normalized_title
  ), ranked as (
    select *, count(*) over () as total
    from candidates
    order by has_approved_image desc, id
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
  elsif candidate_count > 1 then
    with approved as (
      select distinct p.id, p.image_url
      from public.products p
      left join public.product_aliases a on a.product_id = p.id
      where (p.normalized_name = normalized_title or a.normalized_alias = normalized_title)
        and p.image_url is not null
        and p.image_verified = true
        and coalesce(p.image_quality, 0) >= 70
        and p.image_url not like '%/leaflet-crops/%'
    ), approved_ranked as (
      select id, image_url, count(*) over () as total
      from approved
      order by id
    )
    select id, image_url, total
    into matched_product_id, matched_image_url, candidate_count
    from approved_ranked
    limit 1;

    if candidate_count = 1 then
      new.product_id := matched_product_id;
      new.image_url := matched_image_url;
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
  elsif new.image_url like '%/leaflet-crops/%' then
    new.image_url := null;
  end if;

  return new;
end;
$$;

drop trigger if exists offers_match_product_master_trigger on public.offers;
create trigger offers_match_product_master_trigger
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
begin
  if new.product_id is null then
    return new;
  end if;

  normalized_title := public.normalize_product_name(new.title);
  if normalized_title = '' then
    return new;
  end if;

  insert into public.product_aliases(
    product_id,
    alias,
    normalized_alias,
    source_store_id,
    confidence
  ) values (
    new.product_id,
    new.title,
    normalized_title,
    new.store_id,
    1
  )
  on conflict (product_id, normalized_alias)
  do update set
    alias = excluded.alias,
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

update public.offers o
set image_url = case
  when p.image_url is not null
    and p.image_verified = true
    and coalesce(p.image_quality, 0) >= 70
    and p.image_url not like '%/leaflet-crops/%'
  then p.image_url
  else null
end
from public.products p
where o.product_id = p.id
  and (o.image_url like '%/leaflet-crops/%' or o.image_url is null or o.image_url = '');
