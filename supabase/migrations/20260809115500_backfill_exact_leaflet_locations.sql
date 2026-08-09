-- Backfill older PDF pipelines only when title, price and validity resolve to one exact page/document location.

with matches as (
  select
    o.id as offer_id,
    lii.source_page,
    li.source_document_url
  from public.offers o
  join public.leaflet_imports li
    on li.store_id = o.store_id
   and li.detected_valid_from = o.valid_from
   and li.detected_valid_to = o.valid_to
  join public.leaflet_import_items lii
    on lii.import_id = li.id
   and lower(btrim(lii.title)) = lower(btrim(o.title))
   and lii.price = o.price
  where o.status = 'published'
    and o.is_verified = true
    and lii.source_page is not null
    and li.source_document_url ~* '\.pdf(?:\?|$)'
), safe as (
  select offer_id,min(source_page) source_page,min(source_document_url) source_document_url
  from matches
  group by offer_id
  having count(distinct source_page::text || '|' || source_document_url) = 1
)
update public.offers o
set metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
  'leaflet_page', safe.source_page,
  'leaflet_document_url', safe.source_document_url
),
updated_at = now()
from safe
where o.id = safe.offer_id;

create or replace function public.attach_leaflet_location_to_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_document_url text;
  v_store_id uuid;
  v_valid_from date;
  v_valid_to date;
begin
  if new.source_page is null then
    return new;
  end if;

  select source_document_url,store_id,detected_valid_from,detected_valid_to
  into v_document_url,v_store_id,v_valid_from,v_valid_to
  from public.leaflet_imports
  where id = new.import_id;

  if v_document_url is null or v_document_url !~* '\.pdf(?:\?|$)' then
    return new;
  end if;

  if coalesce(new.raw_data->>'offer_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_offer_id := (new.raw_data->>'offer_id')::uuid;
  else
    select min(o.id)
    into v_offer_id
    from public.offers o
    where o.store_id = v_store_id
      and o.valid_from = v_valid_from
      and o.valid_to = v_valid_to
      and lower(btrim(o.title)) = lower(btrim(new.title))
      and o.price = new.price
      and o.status = 'published'
      and o.is_verified = true
    having count(*) = 1;
  end if;

  if v_offer_id is null then
    return new;
  end if;

  update public.offers
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'leaflet_page', new.source_page,
    'leaflet_document_url', v_document_url
  ),
  updated_at = now()
  where id = v_offer_id;

  return new;
end;
$$;
