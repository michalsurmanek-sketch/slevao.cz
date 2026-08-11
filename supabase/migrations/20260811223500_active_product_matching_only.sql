-- Product matching must never revive a quarantined/deactivated catalogue row.
-- This closes both the generic import resolver and the offer trigger paths.

create or replace function public.resolve_product_for_import(
  p_title text,
  p_brand text default null,
  p_quantity text default null,
  p_ean text default null,
  p_store_id uuid default null
)
returns table(matched_product_id uuid, matched_image_url text, match_type text, match_score numeric)
language plpgsql
stable
set search_path to 'public'
as $function$
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
    where p.is_active = true
      and regexp_replace(coalesce(p.ean, ''), '\D', '', 'g') = clean_ean
    limit 1;
    if found then return; end if;
  end if;

  if normalized_title = '' then return; end if;

  if p_store_id is not null then
    select count(distinct p.id)
    into candidate_count
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where p.is_active = true
      and a.normalized_alias = normalized_title
      and a.source_store_id = p_store_id
      and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
      and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity);

    if candidate_count = 1 then
      return query
      select p.id, public.active_verified_product_image(p.id), 'store_alias_exact'::text, 0.9950::numeric
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where p.is_active = true
        and a.normalized_alias = normalized_title
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
  where p.is_active = true
    and a.normalized_alias = normalized_title
    and public.product_match_brand_compatible(coalesce(a.brand, p.brand), p_brand)
    and public.product_match_quantity_compatible(coalesce(a.quantity_text, p.quantity_text), p_quantity);

  if candidate_count = 1 or (candidate_count > 1 and image_candidate_count = 1) then
    return query
    select p.id, public.active_verified_product_image(p.id), 'alias_exact'::text,
           case when candidate_count = 1 then 0.9850::numeric else 0.9650::numeric end
    from public.product_aliases a
    join public.products p on p.id = a.product_id
    where p.is_active = true
      and a.normalized_alias = normalized_title
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
  where p.is_active = true
    and p.normalized_name = normalized_title
    and public.product_match_brand_compatible(p.brand, p_brand)
    and public.product_match_quantity_compatible(p.quantity_text, p_quantity);

  if candidate_count = 1 or (candidate_count > 1 and image_candidate_count = 1) then
    return query
    select p.id, public.active_verified_product_image(p.id), 'name_exact'::text,
           case when candidate_count = 1 then 0.9750::numeric else 0.9550::numeric end
    from public.products p
    where p.is_active = true
      and p.normalized_name = normalized_title
      and public.product_match_brand_compatible(p.brand, p_brand)
      and public.product_match_quantity_compatible(p.quantity_text, p_quantity)
      and (candidate_count = 1 or public.active_verified_product_image(p.id) is not null)
    order by (public.active_verified_product_image(p.id) is not null) desc, p.id
    limit 1;
  end if;
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
  structured_key text;
  product_structured_key text;
  product_source_store text;
begin
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else new.product_id end;
  if new.store_id is not null then select s.slug into store_slug from public.stores s where s.id = new.store_id; end if;
  adapter := lower(coalesce(new.metadata ->> 'adapter', ''));

  if new.product_id is not null and coalesce(new.external_id,'')<>'' then
    structured_key := public.structured_store_identity_key(store_slug,new.external_id);
    select p.metadata->>'structured_identity_key',p.metadata->>'source_store_slug'
      into product_structured_key,product_source_store
    from public.products p where p.id=new.product_id and p.is_active=true;
    if structured_key is not null and product_structured_key=structured_key and product_source_store=store_slug then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
  end if;

  if store_slug = 'albert' and adapter = 'albert-products-publitas-text-v4' and new.product_id is not null then
    parsed_quantity := public.product_quantity_key(new.metadata ->> 'parsed_quantity');
    select public.product_quantity_key(coalesce(p.quantity_text, p.name)) into intended_quantity
    from public.products p where p.id = new.product_id and p.is_active=true;
    if parsed_quantity is not null and intended_quantity = parsed_quantity then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
  end if;

  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> 'kaufland_kl_nr', '')), '');
  if store_slug = 'kaufland' and offer_kl_nr is not null and new.product_id is not null then
    select nullif(trim(coalesce(p.metadata ->> 'kaufland_kl_nr', '')), '') into product_kl_nr
    from public.products p where p.id = new.product_id and p.is_active=true;
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
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
    end if;
    return new;
  end if;

  with candidates as (
    select distinct p.id,
      case when p.image_url is not null and p.image_verified = true and coalesce(p.image_quality, 0) >= 70 and p.image_url not like '%/leaflet-crops/%' then p.image_url else null end as approved_image
    from public.products p
    where p.is_active = true
      and p.normalized_name = normalized_title
      and public.product_identity_match_safe(new.title, p.name, p.brand, p.quantity_text)
  ), ranked as (
    select *, count(*) over () as total from candidates order by (approved_image is not null) desc, id
  )
  select id, approved_image, total into matched_product_id, matched_image_url, candidate_count from ranked limit 1;
  if not found then candidate_count := 0; matched_product_id := null; matched_image_url := null; end if;

  if candidate_count = 0 then
    with candidates as (
      select distinct p.id,
        case when p.image_url is not null and p.image_verified = true and coalesce(p.image_quality, 0) >= 70 and p.image_url not like '%/leaflet-crops/%' then p.image_url else null end as approved_image
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where p.is_active = true
        and a.normalized_alias = normalized_title
        and a.confidence >= 0.92
        and (a.brand is not null or a.quantity_text is not null)
        and public.product_identity_match_safe(new.title,a.alias,coalesce(a.brand,p.brand),coalesce(a.quantity_text,p.quantity_text))
    ), ranked as (
      select *, count(*) over () as total from candidates order by (approved_image is not null) desc, id
    )
    select id, approved_image, total into matched_product_id, matched_image_url, candidate_count from ranked limit 1;
    if not found then candidate_count := 0; matched_product_id := null; matched_image_url := null; end if;
  end if;

  if candidate_count = 1 then
    new.product_id := matched_product_id;
    if matched_image_url is not null then new.image_url := matched_image_url;
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
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
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
    end if;
  end if;
  return new;
end;
$function$;

-- Published/upcoming offers attached to a quarantined product must not remain
-- public. Current audit shows only parser-noise rows; this predicate is general
-- and future-safe.
update public.offers o
set status='expired',
    metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
      'quarantined_at',now(),
      'quarantine_reason','linked_product_inactive'
    ),
    updated_at=now()
from public.products p
where o.product_id=p.id
  and p.is_active=false
  and o.status='published'
  and o.valid_to >= (now() at time zone 'Europe/Prague')::date;
