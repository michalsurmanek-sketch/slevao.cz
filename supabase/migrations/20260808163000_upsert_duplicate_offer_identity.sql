-- A publisher can miss an already existing offer when a store has more rows than
-- its client-side lookup page. Convert an identical offer identity insert into
-- an update before the unique index rejects the batch.

create or replace function public.merge_duplicate_offer_identity_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  existing_id uuid;
begin
  select o.id
  into existing_id
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

  if existing_id is null then
    return new;
  end if;

  update public.offers o
  set product_id = coalesce(new.product_id, o.product_id),
      branch_id = coalesce(new.branch_id, o.branch_id),
      flyer_id = coalesce(new.flyer_id, o.flyer_id),
      external_id = coalesce(nullif(new.external_id, ''), o.external_id),
      title = new.title,
      normalized_title = coalesce(new.normalized_title, o.normalized_title),
      description = coalesce(new.description, o.description),
      image_url = coalesce(new.image_url, o.image_url),
      source_url = coalesce(new.source_url, o.source_url),
      price = new.price,
      old_price = coalesce(new.old_price, o.old_price),
      currency = coalesce(new.currency, o.currency),
      package_amount = coalesce(new.package_amount, o.package_amount),
      package_unit = coalesce(new.package_unit, o.package_unit),
      unit_price = coalesce(new.unit_price, o.unit_price),
      unit_price_unit = coalesce(new.unit_price_unit, o.unit_price_unit),
      discount_percent = coalesce(new.discount_percent, o.discount_percent),
      deal_score = coalesce(new.deal_score, o.deal_score),
      status = case
        when new.status = 'published' then 'published'
        when o.status = 'published' then o.status
        else new.status
      end,
      is_featured = coalesce(new.is_featured, o.is_featured),
      is_verified = coalesce(o.is_verified, false) or coalesce(new.is_verified, false),
      confidence_score = greatest(coalesce(o.confidence_score, 0), coalesce(new.confidence_score, 0)),
      metadata = coalesce(o.metadata, '{}'::jsonb)
        || coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
          '_identity_upserted_at', now(),
          '_identity_upsert_reason', 'duplicate_offer_identity'
        ),
      published_at = case
        when new.status = 'published' then coalesce(new.published_at, o.published_at, now())
        else o.published_at
      end,
      category_id = coalesce(new.category_id, o.category_id),
      coverage_scope = new.coverage_scope,
      region_code = new.region_code,
      city_name = new.city_name,
      store_location_name = new.store_location_name,
      updated_at = now()
  where o.id = existing_id;

  -- Returning NULL cancels the duplicate INSERT. The existing row has already
  -- been updated, so the caller receives a successful statement instead of a
  -- unique-constraint error.
  return null;
end;
$function$;

revoke all on function public.merge_duplicate_offer_identity_before_insert() from public, anon, authenticated;
grant execute on function public.merge_duplicate_offer_identity_before_insert() to service_role;

drop trigger if exists aaa_merge_duplicate_offer_identity_before_insert on public.offers;
create trigger aaa_merge_duplicate_offer_identity_before_insert
before insert on public.offers
for each row
execute function public.merge_duplicate_offer_identity_before_insert();