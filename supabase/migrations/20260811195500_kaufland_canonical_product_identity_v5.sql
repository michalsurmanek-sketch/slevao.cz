-- Kaufland klNr is the authoritative SKU identity. Legacy catalogue rows may
-- still carry generic names/old package sizes from pre-v4 imports. Split the
-- few rows shared with another retailer, then canonicalize every current klNr
-- product from the official v4 import.

-- 1) Detach klNr from a legacy generic product if that product is still used
-- by another retailer and its current official Kaufland identity differs.
with latest as (
  select ss.last_import_id as id, s.id as store_id
  from public.store_product_sync_state ss
  join public.stores s on s.id = ss.store_id
  where s.slug = 'kaufland'
), current_rows as (
  select distinct on (li.product_id)
    li.product_id,
    nullif(li.raw_data ->> 'kl_nr', '') as kl_nr,
    li.title as official_title,
    li.quantity_text as official_quantity
  from public.leaflet_import_items li
  join latest l on l.id = li.import_id
  left join public.offers o
    on o.store_id = l.store_id
   and o.external_id = li.raw_data ->> 'offer_id'
  where nullif(li.raw_data ->> 'kl_nr', '') is not null
  order by li.product_id, o.valid_from desc nulls last, o.valid_to desc nulls last, li.id
), shared_mismatch as (
  select r.*
  from current_rows r
  join public.products p on p.id = r.product_id
  where (
      public.normalize_product_name(p.name) <> public.normalize_product_name(r.official_title)
      or public.product_quantity_key(coalesce(p.quantity_text, p.name))
         is distinct from public.product_quantity_key(coalesce(r.official_quantity, r.official_title))
    )
    and exists (
      select 1
      from public.offers ox
      join public.stores sx on sx.id = ox.store_id
      where ox.product_id = p.id
        and sx.slug <> 'kaufland'
        and ox.status = 'published'
        and ox.valid_to >= (now() at time zone 'Europe/Prague')::date
    )
)
update public.products p
set metadata = coalesce(p.metadata, '{}'::jsonb)
      - 'kaufland_kl_nr'
      - 'kaufland_category'
      - 'kaufland_identity_version'
      || jsonb_build_object(
        '_kaufland_identity_split_at', now(),
        '_kaufland_identity_split_reason', 'legacy_product_shared_with_other_store'
      ),
    updated_at = now()
from shared_mismatch sm
where p.id = sm.product_id;

-- 2) Create a dedicated product for each detached klNr.
with latest as (
  select ss.last_import_id as id, s.id as store_id
  from public.store_product_sync_state ss
  join public.stores s on s.id = ss.store_id
  where s.slug = 'kaufland'
), detached as (
  select distinct on (nullif(li.raw_data ->> 'kl_nr', ''))
    nullif(li.raw_data ->> 'kl_nr', '') as kl_nr,
    li.title as official_title,
    li.quantity_text as official_quantity,
    coalesce(o.image_url, p.image_url) as image_url,
    o.metadata ->> 'kaufland_category_name' as category_name
  from public.leaflet_import_items li
  join latest l on l.id = li.import_id
  join public.products p on p.id = li.product_id
  left join public.offers o
    on o.store_id = l.store_id
   and o.external_id = li.raw_data ->> 'offer_id'
  where nullif(li.raw_data ->> 'kl_nr', '') is not null
    and p.metadata ? '_kaufland_identity_split_at'
    and not exists (
      select 1 from public.products px
      where px.is_active = true
        and px.metadata ->> 'kaufland_kl_nr' = li.raw_data ->> 'kl_nr'
    )
  order by nullif(li.raw_data ->> 'kl_nr', ''), o.valid_from desc nulls last, o.valid_to desc nulls last, li.id
)
insert into public.products(
  name, normalized_name, quantity_text, image_url, image_source,
  image_quality, image_verified, image_checked_at, is_verified, metadata
)
select
  case
    when d.official_quantity is not null
      and right(d.official_title, char_length(' · ' || d.official_quantity)) = ' · ' || d.official_quantity
    then left(d.official_title, char_length(d.official_title) - char_length(' · ' || d.official_quantity))
    else d.official_title
  end,
  public.normalize_product_name(d.official_title),
  d.official_quantity,
  d.image_url,
  case when d.image_url is not null then 'official_kaufland' else null end,
  case when d.image_url is not null then 90 else 0 end,
  d.image_url is not null,
  case when d.image_url is not null then now() else null end,
  true,
  jsonb_strip_nulls(jsonb_build_object(
    'created_from_kaufland_ssr', true,
    'kaufland_identity_version', 5,
    'kaufland_kl_nr', d.kl_nr,
    'kaufland_category', d.category_name,
    'kaufland_canonicalized_at', now(),
    'kaufland_split_from_legacy_shared_product', true
  ))
from detached d;

-- 3) Repoint current Kaufland offers/import items to the dedicated klNr row.
with latest as (
  select ss.last_import_id as id, s.id as store_id
  from public.store_product_sync_state ss
  join public.stores s on s.id = ss.store_id
  where s.slug = 'kaufland'
), mapping as (
  select distinct
    li.raw_data ->> 'offer_id' as external_id,
    p.id as product_id,
    li.id as item_id
  from public.leaflet_import_items li
  join latest l on l.id = li.import_id
  join public.products p
    on p.is_active = true
   and p.metadata ->> 'kaufland_kl_nr' = li.raw_data ->> 'kl_nr'
  where nullif(li.raw_data ->> 'kl_nr', '') is not null
)
update public.offers o
set product_id = m.product_id,
    catalog_match_status = 'matched',
    catalog_match_score = 1,
    catalog_checked_at = now(),
    updated_at = now()
from mapping m
where o.external_id = m.external_id
  and o.store_id = (select store_id from latest)
  and o.product_id is distinct from m.product_id;

with latest as (
  select ss.last_import_id as id
  from public.store_product_sync_state ss
  join public.stores s on s.id = ss.store_id
  where s.slug = 'kaufland'
), mapping as (
  select li.id as item_id, p.id as product_id
  from public.leaflet_import_items li
  join latest l on l.id = li.import_id
  join public.products p
    on p.is_active = true
   and p.metadata ->> 'kaufland_kl_nr' = li.raw_data ->> 'kl_nr'
  where nullif(li.raw_data ->> 'kl_nr', '') is not null
)
update public.leaflet_import_items li
set product_id = m.product_id
from mapping m
where li.id = m.item_id
  and li.product_id is distinct from m.product_id;

-- 4) Canonicalize all current Kaufland product rows from the official import.
with latest as (
  select ss.last_import_id as id, s.id as store_id
  from public.store_product_sync_state ss
  join public.stores s on s.id = ss.store_id
  where s.slug = 'kaufland'
), canonical as (
  select distinct on (li.product_id)
    li.product_id,
    li.title as official_title,
    li.quantity_text as official_quantity,
    nullif(li.raw_data ->> 'kl_nr', '') as kl_nr,
    o.metadata ->> 'kaufland_category_name' as category_name,
    o.image_url as official_image
  from public.leaflet_import_items li
  join latest l on l.id = li.import_id
  left join public.offers o
    on o.store_id = l.store_id
   and o.external_id = li.raw_data ->> 'offer_id'
  where nullif(li.raw_data ->> 'kl_nr', '') is not null
  order by li.product_id, o.valid_from desc nulls last, o.valid_to desc nulls last, li.id
), prepared as (
  select
    c.*,
    case
      when c.official_quantity is not null
        and right(c.official_title, char_length(' · ' || c.official_quantity)) = ' · ' || c.official_quantity
      then left(c.official_title, char_length(c.official_title) - char_length(' · ' || c.official_quantity))
      else c.official_title
    end as canonical_name
  from canonical c
)
update public.products p
set name = x.canonical_name,
    normalized_name = public.normalize_product_name(x.canonical_name),
    quantity_text = x.official_quantity,
    image_url = case
      when x.official_image is not null and (p.image_url is null or coalesce(p.image_quality, 0) < 80)
      then x.official_image else p.image_url end,
    image_source = case
      when x.official_image is not null and (p.image_url is null or coalesce(p.image_quality, 0) < 80)
      then 'official_kaufland' else p.image_source end,
    image_quality = case
      when x.official_image is not null and (p.image_url is null or coalesce(p.image_quality, 0) < 80)
      then 90 else p.image_quality end,
    image_verified = case when x.official_image is not null then true else p.image_verified end,
    image_checked_at = case when x.official_image is not null then now() else p.image_checked_at end,
    is_verified = true,
    is_active = true,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'created_from_kaufland_ssr', true,
      'kaufland_identity_version', 5,
      'kaufland_kl_nr', x.kl_nr,
      'kaufland_category', x.category_name,
      'kaufland_canonicalized_at', now()
    )),
    updated_at = now()
from prepared x
where p.id = x.product_id;

-- Keep a store-scoped alias for the canonical official identity.
with latest as (
  select ss.last_import_id as id, s.id as store_id
  from public.store_product_sync_state ss
  join public.stores s on s.id = ss.store_id
  where s.slug = 'kaufland'
), canonical as (
  select distinct on (li.product_id)
    li.product_id,
    li.title,
    li.quantity_text,
    l.store_id
  from public.leaflet_import_items li
  join latest l on l.id = li.import_id
  order by li.product_id, li.id
)
insert into public.product_aliases(
  product_id, alias, normalized_alias, quantity_text, source_store_id, confidence
)
select
  c.product_id,
  c.title,
  public.normalize_product_name(c.title),
  c.quantity_text,
  c.store_id,
  1
from canonical c
where public.normalize_product_name(c.title) <> ''
on conflict (product_id, normalized_alias)
do update set
  alias = excluded.alias,
  quantity_text = excluded.quantity_text,
  source_store_id = excluded.source_store_id,
  confidence = greatest(public.product_aliases.confidence, excluded.confidence),
  updated_at = now();

-- 5) Future syncs always refresh canonical name/package for a known klNr.
create or replace function public.apply_kaufland_official_offers(
  p_store_id uuid,
  p_import_id uuid,
  p_signature text,
  p_offers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
declare
  v_offer jsonb;
  v_external_id text;
  v_kl_nr text;
  v_title text;
  v_display_title text;
  v_normalized text;
  v_unit text;
  v_image text;
  v_description text;
  v_valid_from date;
  v_valid_to date;
  v_price numeric;
  v_old_price numeric;
  v_discount numeric;
  v_product_id uuid;
  v_offer_id uuid;
  v_total integer := 0;
  v_published integer := 0;
  v_expired integer := 0;
  v_current_ids text[] := array[]::text[];
  v_now timestamptz := now();
begin
  if jsonb_typeof(p_offers) <> 'array' then
    raise exception 'Kaufland produkty nejsou JSON pole.';
  end if;
  if jsonb_array_length(p_offers) < 50 then
    raise exception 'Kaufland vrátil pouze % produktů.', jsonb_array_length(p_offers);
  end if;

  delete from public.leaflet_import_items where import_id = p_import_id;

  for v_offer in select value from jsonb_array_elements(p_offers)
  loop
    v_external_id := nullif(trim(v_offer ->> 'offerId'), '');
    v_kl_nr := nullif(trim(v_offer ->> 'klNr'), '');
    v_title := nullif(trim(coalesce(
      v_offer ->> 'productTitle',
      v_offer ->> 'detailDescription',
      v_offer ->> 'detailTitle',
      v_offer ->> 'title'
    )), '');
    v_unit := nullif(trim(v_offer ->> 'unit'), '');
    v_image := nullif(trim(v_offer ->> 'imageUrl'), '');
    v_description := nullif(trim(v_offer ->> 'detailDescription'), '');
    v_valid_from := nullif(v_offer ->> 'dateFrom', '')::date;
    v_valid_to := nullif(v_offer ->> 'dateTo', '')::date;
    v_price := nullif(v_offer ->> 'price', '')::numeric;
    v_old_price := nullif(v_offer ->> 'oldPrice', '')::numeric;
    if v_old_price is not null and v_old_price < v_price then v_old_price := null; end if;
    v_discount := nullif(v_offer ->> 'discount', '')::numeric;

    if v_external_id is null or v_title is null or v_valid_from is null
       or v_valid_to is null or coalesce(v_price, 0) <= 0 then
      continue;
    end if;

    v_normalized := public.normalize_product_name(v_title);
    if v_unit is not null and position(lower(v_unit) in lower(v_title)) = 0 then
      v_display_title := v_title || ' · ' || v_unit;
    else
      v_display_title := v_title;
    end if;

    v_total := v_total + 1;
    v_current_ids := array_append(v_current_ids, v_external_id);
    v_product_id := null;

    if v_kl_nr is not null then
      select p.id into v_product_id
      from public.products p
      where p.is_active = true
        and p.metadata ->> 'kaufland_kl_nr' = v_kl_nr
      order by p.is_verified desc, p.created_at, p.id
      limit 1;
    end if;

    if v_product_id is null then
      insert into public.products(
        name, normalized_name, quantity_text, image_url, image_source,
        image_quality, image_verified, image_checked_at, is_verified, metadata
      ) values (
        v_title,
        v_normalized,
        v_unit,
        v_image,
        case when v_image is not null then 'official_kaufland' else null end,
        case when v_image is not null then 90 else 0 end,
        v_image is not null,
        case when v_image is not null then v_now else null end,
        true,
        jsonb_strip_nulls(jsonb_build_object(
          'created_from_kaufland_ssr', true,
          'kaufland_identity_version', 5,
          'kaufland_kl_nr', v_kl_nr,
          'kaufland_category', v_offer ->> 'categoryDisplayName',
          'kaufland_canonicalized_at', v_now
        ))
      ) returning id into v_product_id;
    else
      update public.products
      set is_active = true,
          is_verified = true,
          name = v_title,
          normalized_name = v_normalized,
          quantity_text = v_unit,
          image_url = case when v_image is not null and (image_url is null or coalesce(image_quality,0) < 80) then v_image else image_url end,
          image_source = case when v_image is not null and (image_url is null or coalesce(image_quality,0) < 80) then 'official_kaufland' else image_source end,
          image_quality = case when v_image is not null and (image_url is null or coalesce(image_quality,0) < 80) then 90 else image_quality end,
          image_verified = case when v_image is not null then true else image_verified end,
          image_checked_at = case when v_image is not null then v_now else image_checked_at end,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'created_from_kaufland_ssr', true,
            'kaufland_identity_version', 5,
            'kaufland_kl_nr', v_kl_nr,
            'kaufland_category', v_offer ->> 'categoryDisplayName',
            'kaufland_canonicalized_at', v_now
          )),
          updated_at = v_now
      where id = v_product_id;
    end if;

    insert into public.product_aliases(product_id, alias, normalized_alias, quantity_text, source_store_id, confidence)
    values(v_product_id, v_title, v_normalized, v_unit, p_store_id, 1)
    on conflict (product_id, normalized_alias)
    do update set
      alias = excluded.alias,
      quantity_text = excluded.quantity_text,
      source_store_id = excluded.source_store_id,
      confidence = greatest(public.product_aliases.confidence, excluded.confidence),
      updated_at = now();

    select id into v_offer_id
    from public.offers
    where store_id = p_store_id
      and external_id = v_external_id
      and valid_from = v_valid_from
      and valid_to = v_valid_to
    limit 1;

    if v_offer_id is null then
      insert into public.offers(
        product_id, store_id, external_id, title, normalized_title, description,
        image_url, source_url, price, old_price, discount_percent,
        valid_from, valid_to, status, is_verified, confidence_score,
        coverage_scope, metadata, published_at
      ) values (
        v_product_id, p_store_id, v_external_id, v_display_title, v_normalized,
        v_description, v_image,
        'https://prodejny.kaufland.cz/nabidka/prehled.html?kloffer-week=current',
        v_price, v_old_price, v_discount, v_valid_from, v_valid_to,
        'published', true, 0.99, 'national',
        jsonb_build_object(
          'adapter','kaufland-products-v4-ssr',
          'kaufland_offer_id',v_external_id,
          'kaufland_kl_nr',v_kl_nr,
          'kaufland_label',v_offer ->> 'label',
          'kaufland_category',v_offer ->> 'categoryName',
          'kaufland_category_name',v_offer ->> 'categoryDisplayName',
          'kaufland_base_price',v_offer ->> 'basePrice',
          'kaufland_source_signature',p_signature,
          'import_id',p_import_id,
          'imported_at',v_now
        ),
        v_now
      ) returning id into v_offer_id;
    else
      update public.offers
      set external_id = v_external_id,
          product_id = v_product_id,
          title = v_display_title,
          normalized_title = v_normalized,
          description = v_description,
          image_url = coalesce(v_image, image_url),
          source_url = 'https://prodejny.kaufland.cz/nabidka/prehled.html?kloffer-week=current',
          price = v_price,
          old_price = v_old_price,
          discount_percent = v_discount,
          status = 'published',
          is_verified = true,
          confidence_score = 0.99,
          metadata = jsonb_build_object(
            'adapter','kaufland-products-v4-ssr',
            'kaufland_offer_id',v_external_id,
            'kaufland_kl_nr',v_kl_nr,
            'kaufland_label',v_offer ->> 'label',
            'kaufland_category',v_offer ->> 'categoryName',
            'kaufland_category_name',v_offer ->> 'categoryDisplayName',
            'kaufland_base_price',v_offer ->> 'basePrice',
            'kaufland_source_signature',p_signature,
            'import_id',p_import_id,
            'imported_at',v_now
          ),
          published_at = v_now,
          updated_at = v_now
      where id = v_offer_id;
    end if;

    insert into public.leaflet_import_items(
      import_id, product_id, title, quantity_text, price, old_price,
      image_url, confidence, status, raw_data
    ) values (
      p_import_id, v_product_id, v_title, v_unit, v_price, v_old_price,
      v_image, 0.99, 'published',
      jsonb_build_object(
        'offer_id',v_external_id,
        'kl_nr',v_kl_nr,
        'category',v_offer ->> 'categoryDisplayName',
        'label',v_offer ->> 'label',
        'base_price',v_offer ->> 'basePrice',
        'adapter','kaufland-products-v4-ssr'
      )
    );
    v_published := v_published + 1;
  end loop;

  if v_published < greatest(50, ceil(v_total * 0.90)::integer) then
    raise exception 'Kaufland zpracoval jen % z % produktů.', v_published, v_total;
  end if;

  with expired as (
    update public.offers
    set status = 'expired', updated_at = v_now
    where store_id = p_store_id
      and status = 'published'
      and (external_id is null or not (external_id = any(v_current_ids)))
    returning id
  )
  select count(*) into v_expired from expired;

  update public.leaflet_imports
  set status = 'published',
      product_count = v_published,
      error_message = null,
      finished_at = v_now,
      updated_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'adapter','kaufland-products-v4-ssr',
        'published_count',v_published,
        'expired_old_offers',v_expired,
        'source_signature',p_signature,
        'product_identity','strict_kaufland_kl_nr_v5'
      )
  where id = p_import_id;

  return jsonb_build_object('ok',true,'parsed',v_total,'published',v_published,'expired',v_expired);
end;
$function$;
