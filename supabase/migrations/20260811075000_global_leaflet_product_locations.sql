-- Sjednoceni vazby produkt -> konkretni letak -> strana pro vsechny podporovane PDF zdroje.
-- Public leaflet locations jsou v produkci cache tabulka, nikoli VIEW.
-- Pouzivame jen stabilni HTTPS PDF a ignorujeme docasne podepsane Storage URL.

-- 1) Doplnit presnou stranu primo do nabidky. To okamzite pouziva homepage i stranky obchodu.
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

-- 2) Doplnit cache pro detail produktu i kdyz leaflet_import_items.product_id chybi,
-- ale import ma spolehlive offer_id.
insert into public.public_product_leaflet_locations (
  product_id, source_page, import_id, store_id, store_name, store_slug,
  valid_from, valid_to, page_count, document_url, updated_at
)
select distinct on (coalesce(item.product_id,linked_offer.product_id),imp.id,item.source_page)
  coalesce(item.product_id,linked_offer.product_id),
  item.source_page,
  imp.id,
  imp.store_id,
  s.name,
  s.slug,
  imp.detected_valid_from,
  imp.detected_valid_to,
  imp.page_count,
  case
    when coalesce(imp.metadata->>'source_original_url','') ~* '\.pdf(?:\?|$)'
      then imp.metadata->>'source_original_url'
    else imp.source_document_url
  end,
  now()
from public.leaflet_import_items item
join public.leaflet_imports imp on imp.id = item.import_id
join public.stores s on s.id = imp.store_id
left join public.offers linked_offer on item.raw_data->>'offer_id' = linked_offer.id::text
where coalesce(item.product_id,linked_offer.product_id) is not null
  and item.source_page between 1 and 500
  and imp.status in ('completed','published','processed')
  and coalesce(imp.detected_valid_to,current_date) >= current_date - 30
  and (
    coalesce(imp.metadata->>'source_original_url','') ~* '^https://.*\.pdf(?:\?|$)'
    or coalesce(imp.source_document_url,'') ~* '^https://.*\.pdf(?:\?|$)'
  )
  and case
    when coalesce(imp.metadata->>'source_original_url','') ~* '\.pdf(?:\?|$)'
      then imp.metadata->>'source_original_url'
    else imp.source_document_url
  end !~* '/storage/v1/object/sign/'
order by coalesce(item.product_id,linked_offer.product_id),imp.id,item.source_page,item.updated_at desc
on conflict (product_id,import_id,source_page) do update set
  store_id = excluded.store_id,
  store_name = excluded.store_name,
  store_slug = excluded.store_slug,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  page_count = excluded.page_count,
  document_url = excluded.document_url,
  updated_at = now();

-- 3) Publitas a podobne adaptery mohou mit stranu u produktoveho importu,
-- zatimco oficialni PDF je ulozene v druhem importu se stejnym publication_id.
insert into public.public_product_leaflet_locations (
  product_id, source_page, import_id, store_id, store_name, store_slug,
  valid_from, valid_to, page_count, document_url, updated_at
)
select distinct on (coalesce(item.product_id,linked_offer.product_id),doc.id,item.source_page)
  coalesce(item.product_id,linked_offer.product_id),
  item.source_page,
  doc.id,
  src.store_id,
  s.name,
  s.slug,
  coalesce(doc.detected_valid_from,src.detected_valid_from),
  coalesce(doc.detected_valid_to,src.detected_valid_to),
  doc.page_count,
  doc.source_document_url,
  now()
from public.leaflet_import_items item
join public.leaflet_imports src on src.id = item.import_id
join public.stores s on s.id = src.store_id
left join public.offers linked_offer on item.raw_data->>'offer_id' = linked_offer.id::text
join lateral (
  select d.*
  from public.leaflet_imports d
  where d.store_id = src.store_id
    and nullif(d.metadata->>'publication_id','') = nullif(item.raw_data->>'publication_id','')
    and d.source_document_url ~* '^https://.*\.pdf(?:\?|$)'
    and d.source_document_url !~* '/storage/v1/object/sign/'
  order by
    case when d.detected_valid_from = src.detected_valid_from and d.detected_valid_to = src.detected_valid_to then 0 else 1 end,
    d.created_at desc
  limit 1
) doc on true
where coalesce(item.product_id,linked_offer.product_id) is not null
  and item.source_page between 1 and 500
  and nullif(item.raw_data->>'publication_id','') is not null
  and src.status in ('completed','published','processed')
  and coalesce(src.detected_valid_to,current_date) >= current_date - 30
order by coalesce(item.product_id,linked_offer.product_id),doc.id,item.source_page,item.updated_at desc
on conflict (product_id,import_id,source_page) do update set
  store_id = excluded.store_id,
  store_name = excluded.store_name,
  store_slug = excluded.store_slug,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  page_count = excluded.page_count,
  document_url = excluded.document_url,
  updated_at = now();

-- 4) Kazdy dalsi import automaticky propise presnou stranu do offers.metadata.
create or replace function public.attach_leaflet_location_to_offer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

  v_publication_id := coalesce(nullif(new.raw_data->>'publication_id',''),nullif(v_publication_id,''));

  if (v_document_url is null or v_document_url ~* '/storage/v1/object/sign/') and v_publication_id is not null then
    select d.source_document_url
    into v_document_url
    from public.leaflet_imports d
    where d.store_id = v_store_id
      and d.metadata->>'publication_id' = v_publication_id
      and d.source_document_url ~* '^https://.*\.pdf(?:\?|$)'
      and d.source_document_url !~* '/storage/v1/object/sign/'
    order by
      case when d.detected_valid_from = v_valid_from and d.detected_valid_to = v_valid_to then 0 else 1 end,
      d.created_at desc
    limit 1;
  end if;

  if v_document_url is null
     or v_document_url !~* '^https://.*\.pdf(?:\?|$)'
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
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
    'leaflet_page',new.source_page,
    'leaflet_document_url',v_document_url,
    'leaflet_location_source','exact_import_mapping_v2'
  ),
  updated_at = now()
  where id = v_offer_id;

  return new;
end;
$$;

-- 5) Cache pro detail produktu umi odvodit product_id z offer_id a publication_id.
create or replace function public.sync_public_product_leaflet_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  imp_row public.leaflet_imports%rowtype;
  doc_row public.leaflet_imports%rowtype;
  store_row public.stores%rowtype;
  v_product_id uuid;
  v_old_product_id uuid;
  v_document_url text;
  v_cache_import_id uuid;
  v_valid_from date;
  v_valid_to date;
  v_page_count integer;
  v_publication_id text;
begin
  if tg_op = 'DELETE' then
    v_old_product_id := old.product_id;
    if v_old_product_id is null and coalesce(old.raw_data->>'offer_id','') ~* '^[0-9a-f]{8}-[0-9a-f-]{27,}$' then
      select product_id into v_old_product_id from public.offers where id::text = old.raw_data->>'offer_id' limit 1;
    end if;
    if v_old_product_id is not null and old.source_page is not null then
      delete from public.public_product_leaflet_locations
      where product_id = v_old_product_id
        and source_page = old.source_page
        and import_id = old.import_id;
    end if;
    return old;
  end if;

  if new.source_page is null or new.source_page < 1 or new.source_page > 500 then
    return new;
  end if;

  v_product_id := new.product_id;
  if v_product_id is null and coalesce(new.raw_data->>'offer_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select product_id into v_product_id
    from public.offers
    where id = (new.raw_data->>'offer_id')::uuid;
  end if;
  if v_product_id is null then return new; end if;

  select * into imp_row from public.leaflet_imports where id = new.import_id;
  if not found or imp_row.status not in ('completed','published','processed') then return new; end if;
  select * into store_row from public.stores where id = imp_row.store_id;
  if not found then return new; end if;

  v_cache_import_id := imp_row.id;
  v_valid_from := imp_row.detected_valid_from;
  v_valid_to := imp_row.detected_valid_to;
  v_page_count := imp_row.page_count;
  v_publication_id := coalesce(nullif(new.raw_data->>'publication_id',''),nullif(imp_row.metadata->>'publication_id',''));
  v_document_url := case
    when coalesce(imp_row.metadata->>'source_original_url','') ~* '\.pdf(?:\?|$)'
      then imp_row.metadata->>'source_original_url'
    when coalesce(imp_row.source_document_url,'') ~* '\.pdf(?:\?|$)'
      then imp_row.source_document_url
    else null
  end;

  if (v_document_url is null or v_document_url ~* '/storage/v1/object/sign/') and v_publication_id is not null then
    select * into doc_row
    from public.leaflet_imports d
    where d.store_id = imp_row.store_id
      and d.metadata->>'publication_id' = v_publication_id
      and d.source_document_url ~* '^https://.*\.pdf(?:\?|$)'
      and d.source_document_url !~* '/storage/v1/object/sign/'
    order by
      case when d.detected_valid_from = imp_row.detected_valid_from and d.detected_valid_to = imp_row.detected_valid_to then 0 else 1 end,
      d.created_at desc
    limit 1;
    if found then
      v_cache_import_id := doc_row.id;
      v_document_url := doc_row.source_document_url;
      v_valid_from := coalesce(doc_row.detected_valid_from,imp_row.detected_valid_from);
      v_valid_to := coalesce(doc_row.detected_valid_to,imp_row.detected_valid_to);
      v_page_count := doc_row.page_count;
    end if;
  end if;

  if v_document_url is null
     or v_document_url !~* '^https://.*\.pdf(?:\?|$)'
     or v_document_url ~* '/storage/v1/object/sign/' then
    return new;
  end if;

  insert into public.public_product_leaflet_locations (
    product_id,source_page,import_id,store_id,store_name,store_slug,
    valid_from,valid_to,page_count,document_url,updated_at
  ) values (
    v_product_id,new.source_page,v_cache_import_id,imp_row.store_id,store_row.name,store_row.slug,
    v_valid_from,v_valid_to,v_page_count,v_document_url,now()
  ) on conflict (product_id,import_id,source_page) do update set
    store_id = excluded.store_id,
    store_name = excluded.store_name,
    store_slug = excluded.store_slug,
    valid_from = excluded.valid_from,
    valid_to = excluded.valid_to,
    page_count = excluded.page_count,
    document_url = excluded.document_url,
    updated_at = now();

  if tg_op = 'UPDATE' and old.product_id is not null and old.source_page is not null
     and (old.product_id,old.import_id,old.source_page) is distinct from (new.product_id,new.import_id,new.source_page) then
    delete from public.public_product_leaflet_locations
    where product_id = old.product_id
      and import_id = old.import_id
      and source_page = old.source_page;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_public_product_leaflet_location() from public,anon,authenticated;

drop trigger if exists sync_public_product_leaflet_location_trigger on public.leaflet_import_items;
create trigger sync_public_product_leaflet_location_trigger
after insert or update or delete on public.leaflet_import_items
for each row execute function public.sync_public_product_leaflet_location();
