-- Albert Publitas v4: publish only identity-safe rows and keep quantity/brand
-- as part of product resolution. The older v3 RPC remains available for
-- rollback, but the v4 edge function calls this RPC.

create or replace function public.publish_albert_publitas_text_offers_v4(
  p_signature text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;
  v_source_id uuid;
  v_import_id uuid;
  v_existing_import uuid;
  v_row jsonb;
  v_product_id uuid;
  v_offer_id uuid;
  v_offer_ids uuid[] := array[]::uuid[];
  v_input_count integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  v_published integer := 0;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_matched integer := 0;
  v_created integer := 0;
  v_from date;
  v_to date;
  v_title text;
  v_display_title text;
  v_norm text;
  v_qty text;
  v_qty_key text;
  v_brand text;
  v_price numeric;
  v_external text;
  v_source_url text;
  v_image text;
  v_conf numeric;
  v_strength text;
  v_now timestamptz := now();
begin
  if coalesce(length(p_signature), 0) < 16 then
    raise exception 'Albert v4 signature je neplatný.';
  end if;
  if v_input_count < 220 then
    raise exception 'Albert v4 parser našel jen % nabídek; bezpečnostní minimum je 220.', v_input_count;
  end if;
  if v_input_count > 900 then
    raise exception 'Albert v4 parser našel podezřele mnoho nabídek: %.', v_input_count;
  end if;

  select id into v_store_id from public.stores where slug = 'albert';
  if v_store_id is null then raise exception 'Albert obchod nebyl nalezen.'; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id = v_store_id and is_active = true
  order by last_success_at desc nulls last, created_at
  limit 1;
  if v_source_id is null then raise exception 'Albert nemá aktivní zdroj.'; end if;

  select id into v_existing_import
  from public.leaflet_imports
  where source_hash = 'albert-products-publitas-text-v4:' || p_signature
  limit 1;

  if v_existing_import is null then
    insert into public.leaflet_imports(
      source_id, store_id, source_document_url, source_hash, status,
      product_count, confidence, coverage_scope, detected_valid_from,
      detected_valid_to, started_at, metadata
    ) values (
      v_source_id, v_store_id, 'https://www.albert.cz/aktualni-letaky',
      'albert-products-publitas-text-v4:' || p_signature,
      'processing', 0, 0.95, 'national', current_date, current_date, v_now,
      jsonb_build_object(
        'adapter', 'albert-products-publitas-text-v4',
        'source_signature', p_signature,
        'automatic', true,
        'identity_model', 'title_brand_quantity_v4'
      )
    ) returning id into v_import_id;
  else
    v_import_id := v_existing_import;
    delete from public.leaflet_import_items where import_id = v_import_id;
    update public.leaflet_imports
    set status = 'processing', error_message = null, started_at = v_now,
        finished_at = null, updated_at = v_now
    where id = v_import_id;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_title := trim(coalesce(v_row ->> 'title', ''));
    v_norm := trim(coalesce(v_row ->> 'normalized_title', ''));
    v_qty := nullif(trim(v_row ->> 'quantity_text'), '');
    v_brand := nullif(trim(v_row ->> 'brand'), '');
    v_price := nullif(v_row ->> 'price', '')::numeric;
    v_external := trim(coalesce(v_row ->> 'external_id', ''));
    v_source_url := nullif(trim(v_row ->> 'source_url'), '');
    v_image := nullif(trim(v_row ->> 'image_url'), '');
    v_conf := coalesce(nullif(v_row ->> 'confidence', '')::numeric, 0.9);
    v_strength := lower(coalesce(nullif(trim(v_row ->> 'identity_strength'), ''), 'medium'));
    v_from := nullif(v_row ->> 'valid_from', '')::date;
    v_to := nullif(v_row ->> 'valid_to', '')::date;
    v_product_id := nullif(v_row ->> 'product_id', '')::uuid;
    v_qty_key := regexp_replace(lower(coalesce(v_qty, '')), '[^0-9a-z]+', '', 'g');

    if v_title = '' or v_norm = '' or v_external = ''
       or coalesce(v_price, 0) <= 0 or v_price > 10000
       or v_from is null or v_to is null or v_from > v_to then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Weak single-label rows without any package/brand signal are too risky
    -- for exact product grouping. They may still be visible only when the
    -- parser could recover at least one extra identity signal.
    if v_strength = 'weak' and v_qty is null and v_brand is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_title ~* '(důkladné odstranění|zubního plaku|akční nabídka|běžná cena|vybrané druhy|poslední šance|soutěž|kredity|informací)' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_title ~* '(vodka|(^| )gin($| )|(^| )rum($| )|whisk|likér|aperitivo)' and v_price < 80 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_product_id is not null and not exists (
      select 1
      from public.products p
      where p.id = v_product_id
        and p.is_active = true
        and coalesce(p.normalized_name, public.normalize_product_name(p.name)) = v_norm
        and (
          v_qty is null
          or regexp_replace(lower(coalesce(p.quantity_text, '')), '[^0-9a-z]+', '', 'g') = v_qty_key
        )
        and (
          v_brand is null
          or coalesce(public.normalize_product_name(p.brand), '') = ''
          or public.normalize_product_name(p.brand) = public.normalize_product_name(v_brand)
        )
    ) then
      v_product_id := null;
    end if;

    if v_product_id is null then
      select p.id into v_product_id
      from public.products p
      where p.is_active = true
        and coalesce(p.normalized_name, public.normalize_product_name(p.name)) = v_norm
        and (
          (v_qty is null and coalesce(p.quantity_text, '') = '')
          or (v_qty is not null and regexp_replace(lower(coalesce(p.quantity_text, '')), '[^0-9a-z]+', '', 'g') = v_qty_key)
        )
        and (
          v_brand is null
          or coalesce(public.normalize_product_name(p.brand), '') = ''
          or public.normalize_product_name(p.brand) = public.normalize_product_name(v_brand)
        )
      order by
        (coalesce(public.normalize_product_name(p.brand), '') = public.normalize_product_name(coalesce(v_brand, ''))) desc,
        p.is_verified desc,
        p.image_verified desc,
        p.created_at
      limit 1;
    else
      v_matched := v_matched + 1;
    end if;

    if v_product_id is null then
      insert into public.products(
        name, normalized_name, brand, quantity_text, image_url,
        image_source, image_quality, image_verified, image_checked_at,
        is_verified, metadata
      ) values (
        v_title, v_norm, v_brand, v_qty, v_image,
        case when v_image is not null then 'official_albert_publitas' else null end,
        case when v_image is not null then 85 else 0 end,
        v_image is not null,
        case when v_image is not null then v_now else null end,
        (v_strength = 'strong' and v_brand is not null and v_qty is not null),
        jsonb_build_object(
          'created_from_albert_publitas_text_v4', true,
          'albert_identity_strength', v_strength,
          'created_at', v_now
        )
      ) returning id into v_product_id;
      v_created := v_created + 1;
    end if;

    if not exists (
      select 1 from public.product_aliases
      where product_id = v_product_id and normalized_alias = v_norm
    ) then
      insert into public.product_aliases(
        product_id, alias, normalized_alias, brand, quantity_text,
        source_store_id, confidence
      ) values (
        v_product_id, v_title, v_norm, v_brand, v_qty, v_store_id,
        least(1, greatest(0.75, v_conf))
      )
      on conflict (product_id, normalized_alias) do nothing;
    end if;

    if v_image is null then
      select image_url into v_image from public.products where id = v_product_id;
    end if;

    v_display_title := v_title || case when v_qty is not null then ' · ' || v_qty else '' end;

    v_offer_id := null;
    select o.id into v_offer_id
    from public.offers o
    where o.store_id = v_store_id and o.external_id = v_external
    order by case when o.status = 'published' then 0 else 1 end, o.created_at
    limit 1;

    if v_offer_id is null then
      insert into public.offers(
        product_id, store_id, title, normalized_title, image_url, source_url,
        external_id, price, old_price, valid_from, valid_to, status,
        is_verified, confidence_score, coverage_scope, metadata, published_at
      ) values (
        v_product_id, v_store_id, v_display_title, v_norm, v_image, v_source_url,
        v_external, v_price, null, v_from, v_to, 'published',
        v_strength = 'strong' and v_conf >= 0.93,
        v_conf, 'national',
        coalesce(v_row -> 'metadata', '{}'::jsonb) || jsonb_build_object(
          'adapter', 'albert-products-publitas-text-v4',
          'source_signature', p_signature,
          'import_id', v_import_id,
          'parsed_brand', v_brand,
          'parsed_quantity', v_qty,
          'identity_strength', v_strength
        ),
        v_now
      ) returning id into v_offer_id;
    else
      update public.offers
      set product_id = v_product_id,
          title = v_display_title,
          normalized_title = v_norm,
          image_url = coalesce(v_image, image_url),
          source_url = v_source_url,
          external_id = v_external,
          price = v_price,
          old_price = null,
          valid_from = v_from,
          valid_to = v_to,
          status = 'published',
          is_verified = v_strength = 'strong' and v_conf >= 0.93,
          confidence_score = v_conf,
          coverage_scope = 'national',
          region_code = null,
          city_name = null,
          store_location_name = case
            when upper(coalesce(v_row #>> '{metadata,location_type}', '')) = 'HYPERMARKET' then 'Hypermarket'
            when upper(coalesce(v_row #>> '{metadata,location_type}', '')) = 'SUPERMARKET' then 'Supermarket'
            else null
          end,
          metadata = coalesce(v_row -> 'metadata', '{}'::jsonb) || jsonb_build_object(
            'adapter', 'albert-products-publitas-text-v4',
            'source_signature', p_signature,
            'import_id', v_import_id,
            'parsed_brand', v_brand,
            'parsed_quantity', v_qty,
            'identity_strength', v_strength
          ),
          published_at = v_now,
          updated_at = v_now
      where id = v_offer_id;
    end if;

    v_offer_ids := array_append(v_offer_ids, v_offer_id);
    v_published := v_published + 1;

    insert into public.leaflet_import_items(
      import_id, product_id, title, brand, quantity_text, price, old_price,
      image_url, source_page, confidence, status, raw_data
    ) values (
      v_import_id, v_product_id, v_title, v_brand, v_qty, v_price, null,
      v_image, nullif(v_row ->> 'source_page', '')::int, v_conf,
      'published',
      coalesce(v_row -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'offer_id', v_offer_id,
        'external_id', v_external,
        'identity_strength', v_strength
      )
    );
  end loop;

  if v_published < 200 then
    raise exception 'Albert v4 po bezpečnostních filtrech ponechal jen % nabídek; předchozí sada zůstává zachovaná.', v_published;
  end if;

  with expired as (
    update public.offers
    set status = 'expired', updated_at = v_now
    where store_id = v_store_id
      and status = 'published'
      and not (id = any(v_offer_ids))
    returning id
  )
  select count(*) into v_expired from expired;

  select min((x ->> 'valid_from')::date), max((x ->> 'valid_to')::date)
  into v_from, v_to
  from jsonb_array_elements(p_rows) x;

  update public.leaflet_imports
  set status = 'published',
      product_count = v_published,
      confidence = 0.95,
      detected_valid_from = v_from,
      detected_valid_to = v_to,
      error_message = null,
      finished_at = v_now,
      metadata = jsonb_build_object(
        'adapter', 'albert-products-publitas-text-v4',
        'source_signature', p_signature,
        'automatic', true,
        'matched_catalog_products', v_matched,
        'created_products', v_created,
        'published_products', v_published,
        'skipped_products', v_skipped,
        'identity_model', 'title_brand_quantity_v4'
      ),
      updated_at = v_now
  where id = v_import_id;

  update public.leaflet_imports
  set status = 'ignored', updated_at = v_now
  where store_id = v_store_id
    and id <> v_import_id
    and status = 'published'
    and metadata ->> 'adapter' in (
      'albert-products-publitas-text-v1',
      'albert-products-publitas-text-v4'
    );

  insert into public.store_product_sync_state(
    store_id, last_run_at, last_success_at, last_source_signature,
    source_fingerprint, product_set_hash, last_offer_count,
    expected_offer_count, last_published_count, last_valid_from, last_valid_to,
    parser_version, adapter_name, adapter_version, source_type,
    source_category, last_error, last_parser_error, health_status,
    health_reason, is_running, run_started_at, updated_at, last_import_id
  ) values (
    v_store_id, v_now, v_now, p_signature, p_signature, p_signature,
    v_published, v_published, v_published, v_from, v_to,
    'albert-publitas-text-v4', 'sync-albert-products',
    'albert-publitas-text-v4', 'official-publitas-text', 'current-leaflets',
    null, null, 'ok',
    format('Albert v4 publikoval %s nabídek s oddělenou identitou názvu, značky a balení.', v_published),
    false, null, v_now, v_import_id
  )
  on conflict (store_id) do update
  set last_run_at = excluded.last_run_at,
      last_success_at = excluded.last_success_at,
      last_source_signature = excluded.last_source_signature,
      source_fingerprint = excluded.source_fingerprint,
      product_set_hash = excluded.product_set_hash,
      last_offer_count = excluded.last_offer_count,
      expected_offer_count = excluded.expected_offer_count,
      last_published_count = excluded.last_published_count,
      last_valid_from = excluded.last_valid_from,
      last_valid_to = excluded.last_valid_to,
      parser_version = excluded.parser_version,
      adapter_name = excluded.adapter_name,
      adapter_version = excluded.adapter_version,
      source_type = excluded.source_type,
      source_category = excluded.source_category,
      last_error = null,
      last_parser_error = null,
      health_status = 'ok',
      health_reason = excluded.health_reason,
      is_running = false,
      run_started_at = null,
      updated_at = v_now,
      last_import_id = v_import_id;

  update public.leaflet_sources
  set last_checked_at = v_now,
      last_success_at = v_now,
      last_error = null,
      last_strategy_used = 'official_publitas_text_products_v4',
      last_strategy_success_at = v_now
  where id = v_source_id;

  return jsonb_build_object(
    'ok', true,
    'import_id', v_import_id,
    'input', v_input_count,
    'published', v_published,
    'skipped', v_skipped,
    'expired', v_expired,
    'matched_catalog_products', v_matched,
    'created_products', v_created,
    'signature', p_signature
  );
end;
$function$;

-- Internal dry-run dispatcher: it never returns the cron secret and is useful
-- for checking parser output before a forced publication.
create or replace function public.trigger_albert_product_sync_dry_run()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret, '') = '' then
    raise warning 'Vault secret slevao_cron_secret is missing.';
    return null;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-albert-products',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := jsonb_build_object('dry_run', true),
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.trigger_albert_product_sync_dry_run() from public;
grant execute on function public.trigger_albert_product_sync_dry_run() to service_role;
