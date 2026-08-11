-- Albert v4 resolves a strong product identity before writing an offer.
-- Generic offer triggers must not replace that explicit product_id with an
-- older catalogue row that only shares a normalized title.

create or replace function public.apply_library_image_to_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  resolved record;
  library_image text;
  store_slug text;
  offer_kl_nr text;
  product_kl_nr text;
  adapter text;
  parsed_quantity text;
  intended_quantity text;
begin
  if new.store_id is not null then
    select s.slug into store_slug from public.stores s where s.id = new.store_id;
  end if;

  adapter := lower(coalesce(new.metadata ->> 'adapter', ''));

  -- Albert v4 already resolved the exact strong identity. Preserve it when
  -- the product package agrees with the parser package.
  if store_slug = 'albert'
     and adapter = 'albert-products-publitas-text-v4'
     and new.product_id is not null then
    parsed_quantity := public.product_quantity_key(new.metadata ->> 'parsed_quantity');
    select public.product_quantity_key(coalesce(p.quantity_text, p.name))
      into intended_quantity
    from public.products p
    where p.id = new.product_id;

    if parsed_quantity is not null and intended_quantity = parsed_quantity then
      library_image := public.active_verified_product_image(new.product_id);
      if library_image is not null then
        new.image_url := library_image;
      elsif new.image_url like '%/leaflet-crops/%' then
        new.image_url := null;
      end if;
      return new;
    end if;
  end if;

  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> 'kaufland_kl_nr', '')), '');
  if store_slug = 'kaufland' and offer_kl_nr is not null and new.product_id is not null then
    select nullif(trim(coalesce(p.metadata ->> 'kaufland_kl_nr', '')), '')
      into product_kl_nr
    from public.products p
    where p.id = new.product_id;
    if product_kl_nr = offer_kl_nr then
      library_image := public.active_verified_product_image(new.product_id);
      if library_image is not null then new.image_url := library_image;
      elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
      end if;
      return new;
    end if;
  end if;

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
$function$;

create or replace function public.match_offer_to_product_master()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  normalized_title text;
  matched_product_id uuid;
  matched_image_url text;
  candidate_count integer := 0;
  previous_product_id uuid;
  store_slug text;
  offer_kl_nr text;
  product_kl_nr text;
  adapter text;
  parsed_quantity text;
  intended_quantity text;
begin
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else new.product_id end;
  if new.store_id is not null then
    select s.slug into store_slug from public.stores s where s.id = new.store_id;
  end if;

  adapter := lower(coalesce(new.metadata ->> 'adapter', ''));

  -- The Albert v4 parser publishes only strong identities and explicitly
  -- chooses product_id. Do not collapse it back to a generic catalogue row.
  if store_slug = 'albert'
     and adapter = 'albert-products-publitas-text-v4'
     and new.product_id is not null then
    parsed_quantity := public.product_quantity_key(new.metadata ->> 'parsed_quantity');
    select public.product_quantity_key(coalesce(p.quantity_text, p.name))
      into intended_quantity
    from public.products p
    where p.id = new.product_id;

    if parsed_quantity is not null and intended_quantity = parsed_quantity then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
  end if;

  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> 'kaufland_kl_nr', '')), '');
  if store_slug = 'kaufland' and offer_kl_nr is not null and new.product_id is not null then
    select nullif(trim(coalesce(p.metadata ->> 'kaufland_kl_nr', '')), '')
      into product_kl_nr
    from public.products p
    where p.id = new.product_id;
    if product_kl_nr = offer_kl_nr then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
    new.catalog_match_status := 'needs_review';
    new.catalog_match_score := null;
    new.catalog_checked_at := now();
    return new;
  end if;

  normalized_title := public.normalize_product_name(new.title);
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
    where p.normalized_name = normalized_title
      and public.product_identity_match_safe(new.title, p.name, p.brand, p.quantity_text)
  ), ranked as (
    select *, count(*) over () as total
    from candidates
    order by (approved_image is not null) desc, id
  )
  select id, approved_image, total
    into matched_product_id, matched_image_url, candidate_count
  from ranked
  limit 1;

  if not found then
    candidate_count := 0;
    matched_product_id := null;
    matched_image_url := null;
  end if;

  if candidate_count = 0 then
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
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where a.normalized_alias = normalized_title
        and a.confidence >= 0.92
        and (a.brand is not null or a.quantity_text is not null)
        and public.product_identity_match_safe(
          new.title,
          a.alias,
          coalesce(a.brand, p.brand),
          coalesce(a.quantity_text, p.quantity_text)
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

    if not found then
      candidate_count := 0;
      matched_product_id := null;
      matched_image_url := null;
    end if;
  end if;

  if candidate_count = 1 then
    new.product_id := matched_product_id;
    if matched_image_url is not null then
      new.image_url := matched_image_url;
    elsif new.image_url like '%/leaflet-crops/%' then
      new.image_url := null;
    end if;
    new.catalog_match_status := case when previous_product_id = matched_product_id then 'retained' else 'matched' end;
    new.catalog_match_score := 1;
    new.catalog_checked_at := now();
  else
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
$function$;

-- Repair the current Albert v4 publication from the import items. The import
-- item stores the product_id chosen by the strict parser before offer triggers
-- run, so this restores the intended identity without hardcoded generated IDs.
with latest as (
  select li.id
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id
  where s.slug = 'albert'
    and li.status = 'published'
    and li.metadata ->> 'adapter' = 'albert-products-publitas-text-v4'
  order by li.finished_at desc nulls last, li.updated_at desc
  limit 1
), intended as (
  select
    (item.raw_data ->> 'offer_id')::uuid as offer_id,
    item.product_id
  from public.leaflet_import_items item
  join latest l on l.id = item.import_id
  where item.product_id is not null
    and coalesce(item.raw_data ->> 'offer_id', '') <> ''
)
update public.offers o
set product_id = i.product_id,
    catalog_match_status = 'matched',
    catalog_match_score = 1,
    catalog_checked_at = now(),
    updated_at = now()
from intended i
where o.id = i.offer_id
  and o.product_id is distinct from i.product_id
  and o.metadata ->> 'adapter' = 'albert-products-publitas-text-v4';
