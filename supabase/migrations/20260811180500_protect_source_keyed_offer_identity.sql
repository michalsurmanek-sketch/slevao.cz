-- Nabídky se stabilním externím ID mají vlastní zdrojovou identitu.
-- Kaufland navíc nese autoritativní klNr; obecné title/alias triggery nesmí
-- přepsat product_id, který už určil strict klNr import.

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
begin
  if new.store_id is not null then
    select s.slug into store_slug from public.stores s where s.id = new.store_id;
  end if;
  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> 'kaufland_kl_nr', '')), '');

  if store_slug = 'kaufland' and offer_kl_nr is not null and new.product_id is not null then
    select nullif(trim(coalesce(p.metadata ->> 'kaufland_kl_nr', '')), '')
      into product_kl_nr
    from public.products p
    where p.id = new.product_id;

    -- Strict klNr výsledek nesmí přepsat obecný resolver názvu.
    if product_kl_nr = offer_kl_nr then
      library_image := public.active_verified_product_image(new.product_id);
      if library_image is not null then
        new.image_url := library_image;
      elsif new.image_url like '%/leaflet-crops/%' then
        new.image_url := null;
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
begin
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else new.product_id end;

  if new.store_id is not null then
    select s.slug into store_slug from public.stores s where s.id = new.store_id;
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

    -- U stabilního Kaufland klNr je nejednoznačnost bezpečnější než chybné
    -- přepárování podle obecného názvu.
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

create or replace function public.merge_duplicate_offer_identity_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  existing_id uuid;
  existing_locked boolean := false;
begin
  -- Zdroje se stabilním external_id mají vlastní unikátní index a nesmí se
  -- sloučit jen proto, že dva různé produkty mají stejný marketingový název.
  if nullif(trim(coalesce(new.external_id, '')), '') is not null then
    return new;
  end if;

  select o.id, coalesce((o.metadata ->> '_manual_delete_lock')::boolean, false)
  into existing_id, existing_locked
  from public.offers o
  where o.store_id = new.store_id
    and lower(btrim(o.title)) = lower(btrim(new.title))
    and o.valid_from = new.valid_from
    and o.valid_to = new.valid_to
    and o.coverage_scope = new.coverage_scope
    and coalesce(o.region_code, '') = coalesce(new.region_code, '')
    and coalesce(o.city_name, '') = coalesce(new.city_name, '')
    and coalesce(o.store_location_name, '') = coalesce(new.store_location_name, '')
  order by o.updated_at desc nulls last, o.created_at desc
  limit 1
  for update;

  if existing_id is null then return new; end if;
  if existing_locked then return null; end if;

  update public.offers o
  set product_id = coalesce(new.product_id, o.product_id),
      title = new.title,
      description = coalesce(new.description, o.description),
      image_url = coalesce(new.image_url, o.image_url),
      source_url = coalesce(new.source_url, o.source_url),
      price = new.price,
      old_price = case
        when new.old_price is not null and new.old_price >= new.price then new.old_price
        when o.old_price is not null and o.old_price >= new.price then o.old_price
        else null
      end,
      status = case
        when new.status = 'published' then 'published'
        when o.status = 'published' then o.status
        else new.status
      end,
      is_verified = coalesce(o.is_verified, false) or coalesce(new.is_verified, false),
      confidence_score = case
        when o.confidence_score is null then new.confidence_score
        when new.confidence_score is null then o.confidence_score
        else greatest(o.confidence_score, new.confidence_score)
      end,
      metadata = coalesce(o.metadata, '{}'::jsonb)
        || coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object('_identity_upserted_at', now(), '_identity_upsert_reason', 'duplicate_offer_identity'),
      published_at = case when new.status = 'published' then coalesce(new.published_at, o.published_at, now()) else o.published_at end,
      category_id = coalesce(new.category_id, o.category_id),
      updated_at = now()
  where o.id = existing_id;

  return null;
end;
$function$;

-- Pro zdroje s external_id zajišťují identitu specializované unique indexy.
-- Textový importní unikát zůstává pouze pro starší/neklíčované zdroje.
drop index if exists public.offers_import_identity_uidx;
create unique index offers_import_identity_uidx
on public.offers (
  store_id,
  lower(btrim(title)),
  valid_from,
  valid_to,
  coverage_scope,
  coalesce(region_code, ''),
  coalesce(city_name, ''),
  coalesce(store_location_name, '')
)
where external_id is null or btrim(external_id) = '';
