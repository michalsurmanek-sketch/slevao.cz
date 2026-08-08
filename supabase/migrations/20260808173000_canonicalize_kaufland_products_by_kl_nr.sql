-- Kaufland exposes a stable klNr for each product. Previous syncs resolved
-- products mainly by title/unit, so small title changes created a new active
-- product on every run. Canonicalize existing rows and make klNr the primary
-- identity for future official syncs.

with ranked as (
  select
    p.id,
    p.metadata ->> 'kaufland_kl_nr' as kl_nr,
    row_number() over (
      partition by p.metadata ->> 'kaufland_kl_nr'
      order by
        exists (
          select 1
          from public.offers o
          where o.product_id = p.id
            and o.status = 'published'
            and o.valid_to >= (now() at time zone 'Europe/Prague')::date
        ) desc,
        p.is_verified desc,
        p.image_verified desc,
        p.created_at asc,
        p.id
    ) as rn
  from public.products p
  where p.is_active = true
    and coalesce(p.metadata ->> 'kaufland_kl_nr', '') <> ''
), duplicates as (
  select id, kl_nr
  from ranked
  where rn > 1
)
update public.products p
set is_active = false,
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      '_canonicalized_at', now(),
      '_canonicalized_reason', 'duplicate_kaufland_kl_nr'
    ),
    updated_at = now()
from duplicates d
where p.id = d.id;

create unique index if not exists ux_products_active_kaufland_kl_nr
on public.products ((metadata ->> 'kaufland_kl_nr'))
where is_active = true
  and coalesce(metadata ->> 'kaufland_kl_nr', '') <> '';

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
  v_identity_keys text[] := array[]::text[];
  v_identity_key text;
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
    v_title := nullif(trim(coalesce(v_offer ->> 'detailTitle', v_offer ->> 'title')), '');
    v_unit := nullif(trim(v_offer ->> 'unit'), '');
    v_image := nullif(trim(v_offer ->> 'imageUrl'), '');
    v_description := nullif(trim(v_offer ->> 'detailDescription'), '');
    v_valid_from := nullif(v_offer ->> 'dateFrom', '')::date;
    v_valid_to := nullif(v_offer ->> 'dateTo', '')::date;
    v_price := nullif(v_offer ->> 'price', '')::numeric;
    v_old_price := nullif(v_offer ->> 'oldPrice', '')::numeric;
    if v_old_price is not null and v_old_price < v_price then
      v_old_price := null;
    end if;
    v_discount := nullif(v_offer ->> 'discount', '')::numeric;

    if v_external_id is null or v_title is null or v_valid_from is null
       or v_valid_to is null or coalesce(v_price, 0) <= 0 then
      continue;
    end if;

    v_normalized := trim(lower(regexp_replace(v_title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')));
    v_display_title := v_title || case when v_unit is not null then ' · ' || v_unit else '' end;
    v_identity_key := lower(trim(v_display_title)) || '|' || v_valid_from::text || '|' || v_valid_to::text;
    if v_identity_key = any(v_identity_keys) then
      continue;
    end if;
    v_identity_keys := array_append(v_identity_keys, v_identity_key);
    v_total := v_total + 1;
    v_current_ids := array_append(v_current_ids, v_external_id);
    v_product_id := null;

    -- Stable Kaufland identity has priority over title/alias matching.
    if v_kl_nr is not null then
      select p.id into v_product_id
      from public.products p
      where p.metadata ->> 'kaufland_kl_nr' = v_kl_nr
      order by p.is_active desc, p.is_verified desc, p.created_at asc, p.id
      limit 1;
    end if;

    if v_product_id is null then
      select pa.product_id into v_product_id
      from public.product_aliases pa
      join public.products p on p.id = pa.product_id and p.is_active = true
      where pa.normalized_alias = v_normalized
        and (pa.source_store_id = p_store_id or pa.source_store_id is null)
      order by case when pa.source_store_id = p_store_id then 0 else 1 end, pa.confidence desc
      limit 1;
    end if;

    if v_product_id is null then
      select p.id into v_product_id
      from public.products p
      where p.is_active = true
        and coalesce(p.normalized_name, trim(lower(regexp_replace(p.name, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')))) = v_normalized
        and coalesce(p.quantity_text, '') = coalesce(v_unit, '')
      order by p.is_verified desc, p.created_at
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
        jsonb_build_object(
          'created_from_kaufland_ssr', true,
          'kaufland_kl_nr', v_kl_nr,
          'kaufland_category', v_offer ->> 'categoryDisplayName'
        )
      )
      returning id into v_product_id;
    else
      update public.products
      set is_active = true,
          is_verified = true,
          image_url = case when (image_url is null or coalesce(image_quality,0) < 80) and v_image is not null then v_image else image_url end,
          image_source = case when (image_url is null or coalesce(image_quality,0) < 80) and v_image is not null then 'official_kaufland' else image_source end,
          image_quality = case when (image_url is null or coalesce(image_quality,0) < 80) and v_image is not null then 90 else image_quality end,
          image_verified = case when (image_url is null or coalesce(image_quality,0) < 80) and v_image is not null then true else image_verified end,
          image_checked_at = case when v_image is not null then v_now else image_checked_at end,
          quantity_text = coalesce(quantity_text, v_unit),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'created_from_kaufland_ssr', true,
            'kaufland_kl_nr', v_kl_nr,
            'kaufland_category', v_offer ->> 'categoryDisplayName'
          ),
          updated_at = v_now
      where id = v_product_id;
    end if;

    if not exists (
      select 1 from public.product_aliases
      where product_id = v_product_id and normalized_alias = v_normalized
    ) then
      insert into public.product_aliases(product_id, alias, normalized_alias, quantity_text, source_store_id, confidence)
      values(v_product_id, v_title, v_normalized, v_unit, p_store_id, 1);
    end if;

    select id into v_offer_id
    from public.offers
    where store_id = p_store_id
      and external_id = v_external_id
      and valid_from = v_valid_from
      and valid_to = v_valid_to
    limit 1;

    if v_offer_id is null then
      select id into v_offer_id
      from public.offers
      where store_id = p_store_id
        and lower(trim(title)) = lower(trim(v_display_title))
        and valid_from = v_valid_from
        and valid_to = v_valid_to
        and coverage_scope = 'national'
        and coalesce(region_code, '') = ''
        and coalesce(city_name, '') = ''
        and coalesce(store_location_name, '') = ''
      order by case when external_id is null then 0 else 1 end, created_at
      limit 1;
    end if;

    if v_offer_id is null then
      insert into public.offers(
        product_id, store_id, external_id, title, normalized_title, description,
        image_url, source_url, price, old_price, discount_percent,
        valid_from, valid_to, status, is_verified, confidence_score,
        coverage_scope, metadata, published_at
      ) values (
        v_product_id,
        p_store_id,
        v_external_id,
        v_display_title,
        v_normalized,
        v_description,
        v_image,
        'https://prodejny.kaufland.cz/nabidka/prehled.html?kloffer-week=current',
        v_price,
        v_old_price,
        v_discount,
        v_valid_from,
        v_valid_to,
        'published',
        true,
        0.99,
        'national',
        jsonb_build_object(
          'adapter','kaufland-products-v3-ssr',
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
      )
      returning id into v_offer_id;
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
            'adapter','kaufland-products-v3-ssr',
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
      p_import_id,
      v_product_id,
      v_title,
      v_unit,
      v_price,
      v_old_price,
      v_image,
      0.99,
      'published',
      jsonb_build_object(
        'offer_id',v_external_id,
        'kl_nr',v_kl_nr,
        'category',v_offer ->> 'categoryDisplayName',
        'label',v_offer ->> 'label',
        'base_price',v_offer ->> 'basePrice',
        'adapter','kaufland-products-v3-ssr'
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
        'adapter','kaufland-products-v3-ssr',
        'published_count',v_published,
        'expired_old_offers',v_expired,
        'source_signature',p_signature,
        'product_identity','kaufland_kl_nr'
      )
  where id = p_import_id;

  return jsonb_build_object('ok',true,'parsed',v_total,'published',v_published,'expired',v_expired);
end;
$function$;