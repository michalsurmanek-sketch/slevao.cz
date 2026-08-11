-- Sjednoceni vazby produkt -> konkretni letak -> strana pro vsechny podporovane PDF zdroje.
-- Zachovava jen spolehlive HTTPS PDF dokumenty a ignoruje docasne podepsane Storage URL.

with direct_candidates as (
  select
    o.id as offer_id,
    lii.source_page,
    case
      when coalesce(li.metadata->>'source_original_url','') ~* '\.pdf(?:\?|$)'
        then li.metadata->>'source_original_url'
      when coalesce(li.source_document_url,'') ~* '\.pdf(?:\?|$)'
        then li.source_document_url
      else null
    end as document_url,
    1 as priority
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id = lii.import_id
  join public.offers o on lii.raw_data->>'offer_id' = o.id::text
  where lii.source_page is not null
), publication_candidates as (
  select
    o.id as offer_id,
    lii.source_page,
    doc.source_document_url as document_url,
    2 as priority
  from public.leaflet_import_items lii
  join public.leaflet_imports src on src.id = lii.import_id
  join public.offers o on lii.raw_data->>'offer_id' = o.id::text
  join lateral (
    select d.source_document_url
    from public.leaflet_imports d
    where d.store_id = src.store_id
      and nullif(d.metadata->>'publication_id','') = nullif(lii.raw_data->>'publication_id','')
      and d.source_document_url ~* '\.pdf(?:\?|$)'
      and d.source_document_url !~* '/storage/v1/object/sign/'
    order by
      case when d.detected_valid_from = src.detected_valid_from and d.detected_valid_to = src.detected_valid_to then 0 else 1 end,
      d.created_at desc
    limit 1
  ) doc on true
  where lii.source_page is not null
    and nullif(lii.raw_data->>'publication_id','') is not null
), candidates as (
  select * from direct_candidates
  union all
  select * from publication_candidates
), resolved as (
  select distinct on (offer_id)
    offer_id,
    source_page,
    document_url
  from candidates
  where document_url is not null
    and document_url ~* '^https://'
    and document_url ~* '\.pdf(?:\?|$)'
    and document_url !~* '/storage/v1/object/sign/'
    and source_page between 1 and 500
  order by offer_id, priority, source_page
)
update public.offers o
set metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
  'leaflet_page', r.source_page,
  'leaflet_document_url', r.document_url,
  'leaflet_location_source', 'exact_import_mapping_v2'
),
updated_at = now()
from resolved r
where o.id = r.offer_id
  and (
    nullif(o.metadata->>'leaflet_page','') is null
    or nullif(o.metadata->>'leaflet_document_url','') is null
  );

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
  v_publication_id text;
begin
  if new.source_page is null or new.source_page < 1 or new.source_page > 500 then
    return new;
  end if;

  select
    store_id,
    detected_valid_from,
    detected_valid_to,
    metadata->>'publication_id',
    case
      when coalesce(metadata->>'source_original_url','') ~* '\.pdf(?:\?|$)'
        then metadata->>'source_original_url'
      when coalesce(source_document_url,'') ~* '\.pdf(?:\?|$)'
        then source_document_url
      else null
    end
  into v_store_id,v_valid_from,v_valid_to,v_publication_id,v_document_url
  from public.leaflet_imports
  where id = new.import_id;

  v_publication_id := coalesce(nullif(new.raw_data->>'publication_id',''), nullif(v_publication_id,''));

  if v_document_url is null and v_publication_id is not null then
    select d.source_document_url
    into v_document_url
    from public.leaflet_imports d
    where d.store_id = v_store_id
      and d.metadata->>'publication_id' = v_publication_id
      and d.source_document_url ~* '\.pdf(?:\?|$)'
      and d.source_document_url !~* '/storage/v1/object/sign/'
    order by
      case when d.detected_valid_from = v_valid_from and d.detected_valid_to = v_valid_to then 0 else 1 end,
      d.created_at desc
    limit 1;
  end if;

  if v_document_url is null
     or v_document_url !~* '^https://'
     or v_document_url !~* '\.pdf(?:\?|$)'
     or v_document_url ~* '/storage/v1/object/sign/' then
    return new;
  end if;

  if coalesce(new.raw_data->>'offer_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_offer_id := (new.raw_data->>'offer_id')::uuid;
  else
    select min(o.id)
    into v_offer_id
    from public.offers o
    where o.store_id = v_store_id
      and o.status = 'published'
      and o.is_verified = true
      and lower(regexp_replace(btrim(o.title),'\s+',' ','g')) = lower(regexp_replace(btrim(new.title),'\s+',' ','g'))
      and o.price = new.price
      and (v_valid_from is null or o.valid_to >= v_valid_from)
      and (v_valid_to is null or o.valid_from <= v_valid_to)
    having count(*) = 1;
  end if;

  if v_offer_id is null then
    return new;
  end if;

  update public.offers
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'leaflet_page', new.source_page,
    'leaflet_document_url', v_document_url,
    'leaflet_location_source', 'exact_import_mapping_v2'
  ),
  updated_at = now()
  where id = v_offer_id;

  return new;
end;
$$;

-- Produktovy detail pouziva tento verejny pohled. Nově umí:
-- 1) existujici presnou metadata vazbu na nabidce,
-- 2) product_id primo z importu,
-- 3) product_id odvozeny z offer_id v raw_data,
-- 4) Publitas publication_id prepojeny na oficialni PDF (napr. Albert/KiK).
create or replace view public.public_product_leaflet_locations
with (security_invoker = false)
as
with metadata_locations as (
  select
    o.product_id,
    (o.metadata->>'leaflet_page')::integer as source_page,
    null::uuid as import_id,
    o.store_id,
    s.name as store_name,
    s.slug as store_slug,
    o.valid_from,
    o.valid_to,
    null::integer as page_count,
    o.metadata->>'leaflet_document_url' as document_url,
    1 as priority,
    o.updated_at as source_updated_at
  from public.offers o
  join public.stores s on s.id = o.store_id
  where o.product_id is not null
    and coalesce(o.metadata->>'leaflet_page','') ~ '^\d+$'
    and (o.metadata->>'leaflet_page')::integer between 1 and 500
    and coalesce(o.metadata->>'leaflet_document_url','') ~* '^https://.*\.pdf(?:\?|$)'
    and coalesce(o.metadata->>'leaflet_document_url','') !~* '/storage/v1/object/sign/'
    and o.valid_to >= current_date - 30
), native_locations as (
  select
    coalesce(item.product_id, linked_offer.product_id) as product_id,
    item.source_page,
    imp.id as import_id,
    imp.store_id,
    s.name as store_name,
    s.slug as store_slug,
    imp.detected_valid_from as valid_from,
    imp.detected_valid_to as valid_to,
    imp.page_count,
    case
      when coalesce(imp.metadata->>'source_original_url','') ~* '\.pdf(?:\?|$)'
        then imp.metadata->>'source_original_url'
      else imp.source_document_url
    end as document_url,
    2 as priority,
    item.updated_at as source_updated_at
  from public.leaflet_import_items item
  join public.leaflet_imports imp on imp.id = item.import_id
  join public.stores s on s.id = imp.store_id
  left join public.offers linked_offer on item.raw_data->>'offer_id' = linked_offer.id::text
  where coalesce(item.product_id, linked_offer.product_id) is not null
    and item.source_page is not null
    and imp.status in ('completed','published','processed')
    and coalesce(imp.detected_valid_to,current_date) >= current_date - 30
), publication_locations as (
  select
    coalesce(item.product_id, linked_offer.product_id) as product_id,
    item.source_page,
    doc.id as import_id,
    src.store_id,
    s.name as store_name,
    s.slug as store_slug,
    coalesce(doc.detected_valid_from,src.detected_valid_from) as valid_from,
    coalesce(doc.detected_valid_to,src.detected_valid_to) as valid_to,
    doc.page_count,
    doc.source_document_url as document_url,
    3 as priority,
    item.updated_at as source_updated_at
  from public.leaflet_import_items item
  join public.leaflet_imports src on src.id = item.import_id
  join public.stores s on s.id = src.store_id
  left join public.offers linked_offer on item.raw_data->>'offer_id' = linked_offer.id::text
  join lateral (
    select d.*
    from public.leaflet_imports d
    where d.store_id = src.store_id
      and nullif(d.metadata->>'publication_id','') = nullif(item.raw_data->>'publication_id','')
      and d.source_document_url ~* '\.pdf(?:\?|$)'
      and d.source_document_url !~* '/storage/v1/object/sign/'
    order by
      case when d.detected_valid_from = src.detected_valid_from and d.detected_valid_to = src.detected_valid_to then 0 else 1 end,
      d.created_at desc
    limit 1
  ) doc on true
  where coalesce(item.product_id, linked_offer.product_id) is not null
    and item.source_page is not null
    and nullif(item.raw_data->>'publication_id','') is not null
    and src.status in ('completed','published','processed')
    and coalesce(src.detected_valid_to,current_date) >= current_date - 30
), all_locations as (
  select * from metadata_locations
  union all
  select * from native_locations
  union all
  select * from publication_locations
), valid_locations as (
  select *
  from all_locations
  where source_page between 1 and 500
    and document_url ~* '^https://.*\.pdf(?:\?|$)'
    and document_url !~* '/storage/v1/object/sign/'
)
select distinct on (product_id,store_id,source_page,document_url,valid_from,valid_to)
  product_id,
  source_page,
  import_id,
  store_id,
  store_name,
  store_slug,
  valid_from,
  valid_to,
  page_count,
  document_url
from valid_locations
order by product_id,store_id,source_page,document_url,valid_from,valid_to,priority,source_updated_at desc;

grant select on public.public_product_leaflet_locations to anon, authenticated;
