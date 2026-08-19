drop materialized view if exists private.public_offer_search_cache_next;

create materialized view private.public_offer_search_cache_next as
with joined as materialized (
  select
    o.id as offer_id,
    o.product_id,
    o.store_id,
    coalesce(o.category_id,p.category_id) as category_id,
    o.title,
    o.description,
    o.price,
    o.old_price,
    coalesce(o.image_url,p.image_url) as image_url,
    o.valid_from,
    o.valid_to,
    o.published_at,
    o.updated_at,
    o.coverage_scope,
    o.region_code,
    o.city_name,
    o.store_location_name,
    o.is_verified,
    o.metadata,
    s.name as store_name,
    s.slug as store_slug,
    s.logo_url as store_logo_url,
    s.primary_color as store_primary_color,
    p.name as product_name,
    p.brand as product_brand,
    p.quantity_text as product_quantity_text,
    p.image_url as product_image_url,
    p.filter_tags as product_filter_tags,
    p.content_form as product_content_form,
    p.classification_confidence as product_classification_confidence,
    c.name as category_name,
    c.slug as category_slug,
    coalesce(p.filter_group,public.infer_public_filter_group(coalesce(nullif(o.title,''),p.name,''),c.slug)) as effective_filter_group,
    trim(regexp_replace(regexp_replace(lower(unaccent(coalesce(nullif(o.title,''),p.name,''))), '\m[0-9]+([.,][0-9]+)?[[:space:]]*(g|kg|ml|l|ks|bal|baleni)\M','','gi'),'[^a-z0-9]+',' ','g')) as dedupe_title,
    public.normalize_text(concat_ws(' ',o.title,p.name,p.brand,c.name,s.name)) as normalized_search,
    public.normalize_text(concat_ws(' ',o.title,p.name,p.brand)) as normalized_product_search,
    public.public_offer_semantic_tags(concat_ws(' ',o.title,p.name,p.brand)) as semantic_tags
  from public.offers o
  join public.stores s on s.id=o.store_id and s.is_active is true
  left join public.products p on p.id=o.product_id
  left join public.categories c on c.id=coalesce(o.category_id,p.category_id)
  where o.status='published' and o.is_verified is true
), ranked as (
  select j.*,
         row_number() over(
           partition by j.store_slug,j.dedupe_title,j.valid_from,j.valid_to
           order by (j.image_url is not null) desc,j.published_at desc nulls last,j.updated_at desc nulls last,j.offer_id
         ) as dedupe_rank
  from joined j
)
select
  offer_id,product_id,store_id,category_id,title,description,price,old_price,image_url,
  valid_from,valid_to,published_at,coverage_scope,region_code,city_name,store_location_name,
  is_verified,metadata,store_name,store_slug,store_logo_url,store_primary_color,
  product_name,product_brand,product_quantity_text,product_image_url,product_filter_tags,
  product_content_form,product_classification_confidence,category_name,category_slug,
  effective_filter_group,normalized_search,normalized_product_search,semantic_tags
from ranked
where dedupe_rank=1;

create unique index public_offer_search_cache_next_offer_id_uidx on private.public_offer_search_cache_next(offer_id);
create index public_offer_search_cache_next_group_idx on private.public_offer_search_cache_next(effective_filter_group,valid_to,valid_from);
create index public_offer_search_cache_next_price_idx on private.public_offer_search_cache_next(price);
create index public_offer_search_cache_next_product_search_trgm_idx on private.public_offer_search_cache_next using gin(normalized_product_search gin_trgm_ops);
create index public_offer_search_cache_next_published_idx on private.public_offer_search_cache_next(published_at desc);
create index public_offer_search_cache_next_region_idx on private.public_offer_search_cache_next(region_code,city_name);
create index public_offer_search_cache_next_search_trgm_idx on private.public_offer_search_cache_next using gin(normalized_search gin_trgm_ops);
create index public_offer_search_cache_next_semantic_tags_gin_idx on private.public_offer_search_cache_next using gin(semantic_tags);
create index public_offer_search_cache_next_store_idx on private.public_offer_search_cache_next(store_slug,valid_to,valid_from);
create index public_offer_search_cache_next_validity_idx on private.public_offer_search_cache_next(valid_to,valid_from);

grant all on table private.public_offer_search_cache_next to anon,authenticated,service_role;
