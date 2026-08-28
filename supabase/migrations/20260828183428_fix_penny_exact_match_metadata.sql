create or replace function private.penny_structured_html_matches_published_set(
  p_html text,
  p_store_id uuid,
  p_signature text,
  p_count integer,
  p_from date,
  p_to date
)
returns boolean
language sql
stable
set search_path = public, private, pg_temp
as $$
with parsed as materialized (
  select * from public.parse_penny_structured_html(p_html)
), target_import as materialized (
  select li.id
  from public.leaflet_imports li
  where li.store_id=p_store_id
    and li.status='published'
    and li.source_hash='penny-structured-html-v1:'||p_signature
    and li.product_count=p_count
    and li.detected_valid_from=p_from
    and li.detected_valid_to=p_to
    and li.metadata->>'adapter'='penny-structured-html-v1'
    and li.metadata->>'source_signature'=p_signature
  order by li.updated_at desc nulls last,li.created_at desc
  limit 1
), campaign as (
  select count(*)::integer as offer_count
  from public.offers o
  where o.store_id=p_store_id
    and o.status='published'
    and o.is_verified=true
    and coalesce(o.metadata->>'adapter','')='penny-structured-html-v1'
    and o.valid_from<=p_to
    and o.valid_to>=p_from
), exact_offer_matches as (
  select count(*)::integer as match_count
  from parsed p
  join public.offers o
    on o.store_id=p_store_id
   and o.external_id='penny-web:'||p.external_id
   and o.title=p.title
   and o.normalized_title=p.normalized_title
   and o.source_url=p.metadata->>'product_url'
   and o.valid_from=p.valid_from
   and o.valid_to=p.valid_to
   and o.price=p.price
   and o.old_price is not distinct from p.old_price
   and o.status='published'
   and o.is_verified=true
   and o.confidence_score=0.99
   and o.coverage_scope='national'
   and o.region_code is null
   and o.city_name is null
   and o.store_location_name is null
   and coalesce(o.metadata->>'adapter','')='penny-structured-html-v1'
   and coalesce(o.metadata->>'source_signature','')=p_signature
   and (o.metadata-'import_id'-'source_signature'-'imported_at'-'source_propagated_from_import_item')=p.metadata
), stored_item_count as (
  select count(*)::integer as item_count
  from public.leaflet_import_items lii
  join target_import ti on ti.id=lii.import_id
), exact_item_matches as (
  select count(*)::integer as match_count
  from parsed p
  join target_import ti on true
  join public.leaflet_import_items lii
    on lii.import_id=ti.id
   and lii.raw_data->>'penny_product_slug'=p.external_id
   and (case
          when coalesce(lii.quantity_text,'')<>''
           and right(lii.title,length(' · '||lii.quantity_text))=' · '||lii.quantity_text
          then left(lii.title,length(lii.title)-length(' · '||lii.quantity_text))
          else lii.title
        end)=p.title
   and lii.quantity_text is not distinct from p.quantity_text
   and lii.price=p.price
   and lii.old_price is not distinct from p.old_price
   and lii.confidence=0.99
   and lii.status='published'
   and (lii.raw_data-'offer_id'-'external_id')=p.metadata
)
select exists(select 1 from target_import)
   and coalesce((select offer_count from campaign),0)=p_count
   and coalesce((select match_count from exact_offer_matches),0)=p_count
   and coalesce((select item_count from stored_item_count),0)=p_count
   and coalesce((select match_count from exact_item_matches),0)=p_count;
$$;