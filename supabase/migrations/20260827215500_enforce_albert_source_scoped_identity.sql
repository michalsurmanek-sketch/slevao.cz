begin;

create unique index if not exists products_albert_source_identity_key_uidx
  on public.products ((metadata ->> 'albert_source_identity_key'))
  where nullif(btrim(metadata ->> 'albert_source_identity_key'), '') is not null;

create or replace function public.enforce_albert_source_scoped_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_store_slug text;
  v_adapter text;
  v_parsed_brand text;
  v_external text;
  v_scoped_product_id uuid;
  v_source_product public.products%rowtype;
  v_raw_title text;
  v_qty text;
  v_original_strength text;
begin
  if new.store_id is null then return new; end if;

  select s.slug into v_store_slug from public.stores s where s.id = new.store_id;
  v_adapter := lower(coalesce(new.metadata ->> 'adapter', ''));
  if v_store_slug <> 'albert' or v_adapter <> 'albert-products-publitas-text-v4' then return new; end if;

  v_parsed_brand := nullif(btrim(new.metadata ->> 'parsed_brand'), '');
  if v_parsed_brand is not null then return new; end if;

  v_external := nullif(btrim(new.external_id), '');
  v_original_strength := nullif(btrim(new.metadata ->> 'identity_strength'), '');
  if v_external is null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'original_identity_strength', coalesce(v_original_strength, 'unknown'),
      'identity_strength', 'needs_review',
      'identity_scope', 'unresolved',
      'identity_reason', 'missing_parsed_brand_and_external_id_v1'
    );
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('slevao:albert-source-identity:' || v_external, 0));

  if new.product_id is not null and exists (
    select 1 from public.products p
    where p.id = new.product_id and p.metadata ->> 'albert_source_identity_key' = v_external
  ) then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'original_identity_strength', coalesce(nullif(new.metadata ->> 'original_identity_strength', ''), coalesce(v_original_strength, 'unknown')),
      'identity_strength', 'source_scoped',
      'identity_scope', 'albert_external_id',
      'identity_reason', 'missing_parsed_brand_source_scoped_v1'
    );
    return new;
  end if;

  select p.id into v_scoped_product_id
  from public.products p
  where p.metadata ->> 'albert_source_identity_key' = v_external
  limit 1;

  if v_scoped_product_id is null then
    if new.product_id is not null then
      select * into v_source_product from public.products p where p.id = new.product_id;
    end if;

    v_raw_title := coalesce(
      nullif(btrim(new.metadata ->> 'raw_title'), ''),
      nullif(btrim(regexp_replace(coalesce(new.title, ''), '[[:space:]]*[·•][[:space:]].*$', '')), ''),
      nullif(btrim(new.title), ''),
      'Albert produkt'
    );
    v_qty := coalesce(
      nullif(btrim(new.metadata ->> 'parsed_quantity'), ''),
      nullif(btrim(v_source_product.quantity_text), '')
    );

    begin
      insert into public.products (
        category_id, name, normalized_name, brand, quantity_text, image_url, is_verified,
        image_source, image_quality, image_verified, image_checked_at,
        filter_group, filter_tags, content_form, classification_confidence,
        classification_source, classified_at, metadata
      ) values (
        v_source_product.category_id,
        v_raw_title,
        public.normalize_product_name(v_raw_title),
        null,
        v_qty,
        coalesce(new.image_url, v_source_product.image_url),
        false,
        v_source_product.image_source,
        coalesce(v_source_product.image_quality, 0),
        coalesce(v_source_product.image_verified, false),
        v_source_product.image_checked_at,
        v_source_product.filter_group,
        coalesce(v_source_product.filter_tags, '{}'::text[]),
        v_source_product.content_form,
        v_source_product.classification_confidence,
        v_source_product.classification_source,
        v_source_product.classified_at,
        jsonb_build_object(
          'created_from_albert_source_scoped_identity', true,
          'albert_source_identity_key', v_external,
          'source_store_slug', 'albert',
          'identity_scope', 'albert_external_id',
          'identity_reason', 'missing_parsed_brand_source_scoped_v1',
          'source_document_id', new.metadata ->> 'source_document_id',
          'publication_id', new.metadata ->> 'publication_id',
          'source_product_id', new.product_id,
          'created_at', clock_timestamp()
        )
      ) returning id into v_scoped_product_id;
    exception when unique_violation then
      select p.id into v_scoped_product_id
      from public.products p
      where p.metadata ->> 'albert_source_identity_key' = v_external
      limit 1;
    end;
  end if;

  if v_scoped_product_id is null then
    raise exception 'Albert source-scoped product could not be resolved for external_id %', v_external;
  end if;

  new.product_id := v_scoped_product_id;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'original_identity_strength', coalesce(v_original_strength, 'unknown'),
    'identity_strength', 'source_scoped',
    'identity_scope', 'albert_external_id',
    'identity_reason', 'missing_parsed_brand_source_scoped_v1'
  );
  return new;
end;
$function$;

drop trigger if exists aab_enforce_albert_source_scoped_identity on public.offers;
create trigger aab_enforce_albert_source_scoped_identity
before insert or update of store_id, product_id, external_id, title, metadata, image_url
on public.offers
for each row execute function public.enforce_albert_source_scoped_identity();

drop trigger if exists record_offer_price_trigger on public.offers;
create trigger record_offer_price_trigger
after insert or update of price, old_price, product_id
on public.offers
for each row execute function public.record_offer_price();

do $backfill$
declare
  v_candidates integer;
  v_updated integer;
  v_unscoped integer;
begin
  select count(*) into v_candidates
  from public.offers o
  join public.stores s on s.id=o.store_id
  where s.slug='albert'
    and o.status='published'
    and o.valid_from<=date '2026-08-27' and o.valid_to>=date '2026-08-27'
    and o.metadata->>'adapter'='albert-products-publitas-text-v4'
    and nullif(btrim(o.metadata->>'parsed_brand'),'') is null
    and nullif(btrim(o.external_id),'') is not null;

  if v_candidates not in (0, 61) then
    raise exception 'Unexpected Albert no-brand backfill candidate count: %', v_candidates;
  end if;

  if v_candidates > 0 then
    update public.offers o
    set product_id=o.product_id
    from public.stores s
    where s.id=o.store_id
      and s.slug='albert'
      and o.status='published'
      and o.valid_from<=date '2026-08-27' and o.valid_to>=date '2026-08-27'
      and o.metadata->>'adapter'='albert-products-publitas-text-v4'
      and nullif(btrim(o.metadata->>'parsed_brand'),'') is null
      and nullif(btrim(o.external_id),'') is not null;
    get diagnostics v_updated = row_count;
    if v_updated <> v_candidates then
      raise exception 'Albert source-scoped backfill update mismatch: expected %, updated %', v_candidates, v_updated;
    end if;
  end if;

  select count(*) into v_unscoped
  from public.offers o
  join public.stores s on s.id=o.store_id
  join public.products p on p.id=o.product_id
  where s.slug='albert'
    and o.status='published'
    and o.valid_from<=date '2026-08-27' and o.valid_to>=date '2026-08-27'
    and o.metadata->>'adapter'='albert-products-publitas-text-v4'
    and nullif(btrim(o.metadata->>'parsed_brand'),'') is null
    and nullif(btrim(o.external_id),'') is not null
    and p.metadata->>'albert_source_identity_key' is distinct from o.external_id;
  if v_unscoped <> 0 then
    raise exception 'Albert source-scoped identity backfill left % offers unresolved', v_unscoped;
  end if;
end
$backfill$;

commit;
