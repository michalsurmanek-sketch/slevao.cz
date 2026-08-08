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
  existing_locked boolean := false;
begin
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

  if existing_id is null then
    return new;
  end if;

  -- A deliberately deleted offer stays suppressed even if an automatic import
  -- encounters the same identity again.
  if existing_locked then
    return null;
  end if;

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
        || jsonb_build_object(
          '_identity_upserted_at', now(),
          '_identity_upsert_reason', 'duplicate_offer_identity'
        ),
      published_at = case
        when new.status = 'published' then coalesce(new.published_at, o.published_at, now())
        else o.published_at
      end,
      category_id = coalesce(new.category_id, o.category_id),
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