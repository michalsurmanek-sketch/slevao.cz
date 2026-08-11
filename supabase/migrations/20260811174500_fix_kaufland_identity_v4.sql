-- Kaufland v4: klNr je autoritativní identita v rámci Kauflandu.
-- Pokud klNr existuje, nesmí se nový produkt připojit jen podle obecného textu
-- typu "Tvoje cena s Kaufland Card". Skutečný název produktu přichází z
-- productTitle/detailDescription a jednotlivé klNr zůstávají oddělené.

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
    if v_old_price is not null and v_old_price < v_price then
      v_old_price := null;
    end if;
    v_discount := nullif(v_offer ->> 'discount', '')::numeric;

    if v_external_id is null or v_title is null or v_valid_from is null
       or v_valid_to is null or coalesce(v_price, 0) <= 0 then
      continue;
    end if;

    v_normalized := trim(lower(regexp_replace(v_title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')));
    if v_unit is not null and position(lower(v_unit) in lower(v_title)) = 0 then
      v_display_title := v_title || ' · ' || v_unit;
    else
      v_display_title := v_title;
    end if;

    v_total := v_total + 1;
    v_current_ids := array_append(v_current_ids, v_external_id);
    v_product_id := null;

    -- Je-li dostupné klNr, je jedinou autoritativní identitou Kaufland produktu.
    -- Žádné fallback párování podle názvu se v této větvi nesmí použít.
    if v_kl_nr is not null then
      select p.id into v_product_id
      from public.products p
      where p.metadata ->> 'kaufland_kl_nr' = v_kl_nr
      order by p.is_active desc, p.is_verified desc, p.created_at asc, p.id
      limit 1;
    else
      -- Fallback pouze pro výjimečný zdrojový řádek bez klNr.
      select pa.product_id into v_product_id
      from public.product_aliases pa
      join public.products p on p.id = pa.product_id and p.is_active = true
      where pa.normalized_alias = v_normalized
        and (pa.source_store_id = p_store_id or pa.source_store_id is null)
      order by case when pa.source_store_id = p_store_id then 0 else 1 end, pa.confidence desc
      limit 1;

      if v_product_id is null then
        select p.id into v_product_id
        from public.products p
        where p.is_active = true
          and coalesce(p.normalized_name, trim(lower(regexp_replace(p.name, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')))) = v_normalized
          and coalesce(p.quantity_text, '') = coalesce(v_unit, '')
        order by p.is_verified desc, p.created_at
        limit 1;
      end if;
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
          'kaufland_identity_version', 4,
          'kaufland_kl_nr', v_kl_nr,
          'kaufland_category', v_offer ->> 'categoryDisplayName'
        ))
      )
      returning id into v_product_id;
    else
      update public.products
      set is_active = true,
          is_verified = true,
          name = case
            when name is null or trim(name) = ''
              or lower(name) like '%tvoje cena%kaufland card%'
              or lower(name) = 'kaufland card'
            then v_title else name end,
          normalized_name = case
            when name is null or trim(name) = ''
              or lower(name) like '%tvoje cena%kaufland card%'
              or lower(name) = 'kaufland card'
            then v_normalized else normalized_name end,
          image_url = case
            when v_image is not null and (
              image_url is null
              or coalesce(image_quality,0) < 80
              or lower(coalesce(name,'')) like '%tvoje cena%kaufland card%'
            ) then v_image else image_url end,
          image_source = case
            when v_image is not null and (
              image_url is null
              or coalesce(image_quality,0) < 80
              or lower(coalesce(name,'')) like '%tvoje cena%kaufland card%'
            ) then 'official_kaufland' else image_source end,
          image_quality = case
            when v_image is not null and (
              image_url is null
              or coalesce(image_quality,0) < 80
              or lower(coalesce(name,'')) like '%tvoje cena%kaufland card%'
            ) then 90 else image_quality end,
          image_verified = case when v_image is not null then true else image_verified end,
          image_checked_at = case when v_image is not null then v_now else image_checked_at end,
          quantity_text = coalesce(quantity_text, v_unit),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'created_from_kaufland_ssr', true,
            'kaufland_identity_version', 4,
            'kaufland_kl_nr', v_kl_nr,
            'kaufland_category', v_offer ->> 'categoryDisplayName'
          )),
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
        'product_identity','strict_kaufland_kl_nr'
      )
  where id = p_import_id;

  return jsonb_build_object('ok',true,'parsed',v_total,'published',v_published,'expired',v_expired);
end;
$function$;

-- Okamžitě oprav již publikované Kaufland nabídky. Každé klNr dostane
-- vlastní master produkt. Existující správný master se zachová, chybějící se
-- vytvoří z popisu nabídky. Historie cen sleduje stejný opravený product_id.
do $repair$
declare
  v_store_id uuid;
  r record;
  v_product_id uuid;
  v_normalized text;
  v_real_title text;
  v_quantity text;
  v_safe_image text;
begin
  select id into v_store_id from public.stores where slug = 'kaufland' limit 1;
  if v_store_id is null then
    raise exception 'Kaufland store nebyl nalezen.';
  end if;

  for r in
    select distinct on (o.metadata ->> 'kaufland_kl_nr')
      o.metadata ->> 'kaufland_kl_nr' as kl_nr,
      o.title as offer_title,
      o.description,
      o.image_url,
      o.valid_to,
      o.updated_at
    from public.offers o
    where o.store_id = v_store_id
      and coalesce(o.metadata ->> 'kaufland_kl_nr', '') <> ''
    order by o.metadata ->> 'kaufland_kl_nr',
      (o.status = 'published') desc,
      o.valid_to desc nulls last,
      o.updated_at desc nulls last
  loop
    v_real_title := coalesce(
      nullif(trim(r.description), ''),
      nullif(trim(split_part(r.offer_title, '·', 1)), ''),
      'Kaufland produkt'
    );
    v_normalized := trim(lower(regexp_replace(v_real_title, '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')));
    v_quantity := nullif(trim(split_part(r.offer_title, '·', 2)), '');
    v_safe_image := case
      when lower(coalesce(r.offer_title,'')) like '%tvoje cena%kaufland card%' then null
      else r.image_url
    end;

    select p.id into v_product_id
    from public.products p
    where p.metadata ->> 'kaufland_kl_nr' = r.kl_nr
    order by p.is_active desc, p.is_verified desc, p.created_at asc, p.id
    limit 1;

    if v_product_id is null then
      insert into public.products(
        name, normalized_name, quantity_text, image_url, image_source,
        image_quality, image_verified, image_checked_at, is_verified, metadata
      ) values (
        v_real_title,
        v_normalized,
        v_quantity,
        v_safe_image,
        case when v_safe_image is not null then 'official_kaufland' else null end,
        case when v_safe_image is not null then 90 else 0 end,
        v_safe_image is not null,
        case when v_safe_image is not null then now() else null end,
        true,
        jsonb_build_object(
          'created_from_kaufland_ssr', true,
          'kaufland_identity_version', 4,
          'kaufland_kl_nr', r.kl_nr,
          'repaired_from_offer_data_at', now()
        )
      )
      returning id into v_product_id;
    else
      update public.products p
      set is_active = true,
          is_verified = true,
          name = case
            when p.name is null or trim(p.name) = ''
              or lower(p.name) like '%tvoje cena%kaufland card%'
              or lower(p.name) = 'kaufland card'
            then v_real_title else p.name end,
          normalized_name = case
            when p.name is null or trim(p.name) = ''
              or lower(p.name) like '%tvoje cena%kaufland card%'
              or lower(p.name) = 'kaufland card'
            then v_normalized else p.normalized_name end,
          quantity_text = coalesce(p.quantity_text, v_quantity),
          image_url = case
            when lower(coalesce(p.name,'')) like '%tvoje cena%kaufland card%' then v_safe_image
            else p.image_url end,
          image_source = case
            when lower(coalesce(p.name,'')) like '%tvoje cena%kaufland card%' and v_safe_image is not null then 'official_kaufland'
            else p.image_source end,
          image_quality = case
            when lower(coalesce(p.name,'')) like '%tvoje cena%kaufland card%' and v_safe_image is not null then 90
            when lower(coalesce(p.name,'')) like '%tvoje cena%kaufland card%' then 0
            else p.image_quality end,
          image_verified = case
            when lower(coalesce(p.name,'')) like '%tvoje cena%kaufland card%' then v_safe_image is not null
            else p.image_verified end,
          metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
            'kaufland_identity_version', 4,
            'kaufland_kl_nr', r.kl_nr,
            'repaired_from_offer_data_at', now()
          ),
          updated_at = now()
      where p.id = v_product_id;
    end if;

    update public.offers o
    set product_id = v_product_id,
        title = case
          when lower(coalesce(o.title,'')) like '%tvoje cena%kaufland card%'
            and nullif(trim(o.description),'') is not null
          then trim(o.description)
          else o.title
        end,
        normalized_title = case
          when lower(coalesce(o.title,'')) like '%tvoje cena%kaufland card%'
            and nullif(trim(o.description),'') is not null
          then trim(lower(regexp_replace(trim(o.description), '[^[:alnum:]á-žÁ-Ž]+', ' ', 'g')))
          else o.normalized_title
        end,
        metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
          'kaufland_identity_version', 4,
          'identity_repaired_at', now()
        ),
        updated_at = now()
    where o.store_id = v_store_id
      and o.metadata ->> 'kaufland_kl_nr' = r.kl_nr;

    update public.price_history ph
    set product_id = v_product_id
    where ph.offer_id in (
      select o.id from public.offers o
      where o.store_id = v_store_id
        and o.metadata ->> 'kaufland_kl_nr' = r.kl_nr
    )
      and ph.product_id is distinct from v_product_id;

    if not exists (
      select 1 from public.product_aliases pa
      where pa.product_id = v_product_id and pa.normalized_alias = v_normalized
    ) then
      insert into public.product_aliases(product_id, alias, normalized_alias, quantity_text, source_store_id, confidence)
      values(v_product_id, v_real_title, v_normalized, v_quantity, v_store_id, 1);
    end if;
  end loop;

  -- Po rozdělení už nesmí zůstat veřejný obecný promo-master bez nabídky.
  update public.products p
  set is_active = false,
      is_verified = false,
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
        '_deactivated_at', now(),
        '_deactivated_reason', 'kaufland_v3_promo_identity_corruption'
      ),
      updated_at = now()
  where lower(coalesce(p.name,'')) like '%tvoje cena%kaufland card%'
    and not exists (select 1 from public.offers o where o.product_id = p.id);

  -- V4 musí při nejbližším běhu zdroj opravdu znovu zpracovat.
  update public.store_product_sync_state
  set last_source_signature = null,
      source_fingerprint = null,
      product_set_hash = null,
      parser_version = 'kaufland-products-v4-ssr',
      adapter_version = 'kaufland-products-v4-ssr',
      health_reason = 'Kaufland identita opravena na strict klNr; čeká se na první v4 refresh.'
  where store_id = v_store_id;
end;
$repair$;
