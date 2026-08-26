create or replace function public.get_public_saved_offer_page(
  p_offer_ids uuid[],
  p_limit integer default 24,
  p_offset integer default 0,
  p_store_slug text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_only_images boolean default false,
  p_query text default null,
  p_filter_group text default null,
  p_region_code text default null,
  p_city_name text default null,
  p_sort text default 'recommended'
)
returns table(offer jsonb, total_count bigint)
language sql
stable
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
with params as (
  select greatest(1,least(coalesce(p_limit,24),100)) row_limit,
         greatest(coalesce(p_offset,0),0) row_offset,
         (timezone('Europe/Prague',now()))::date today,
         nullif(trim(lower(coalesce(p_store_slug,''))),'') store_slug,
         nullif(trim(public.normalize_text(coalesce(p_query,''))),'') query_text,
         nullif(trim(lower(coalesce(p_filter_group,''))),'') filter_group,
         nullif(trim(upper(coalesce(p_region_code,''))),'') region_code,
         nullif(trim(public.normalize_text(coalesce(p_city_name,''))),'') city_name,
         case when p_min_price is null or p_min_price<0 then null else p_min_price end min_price,
         case when p_max_price is null or p_max_price<0 then null else p_max_price end max_price,
         coalesce(p_only_images,false) only_images,
         case when p_sort in ('recommended','priceAsc','priceDesc','newest','ending','discount','saving','name') then p_sort else 'recommended' end sort_mode,
         public.public_semantic_query_tag(p_query) semantic_tag,
         public.public_semantic_tag_filter_group(public.public_semantic_query_tag(p_query)) semantic_group
),
filtered as (
  select c.*
  from private.public_offer_search_cache c
  cross join params x
  where c.offer_id=any(coalesce(p_offer_ids,'{}'::uuid[]))
    and c.valid_to>=x.today
    and c.valid_from<=x.today+7
    and (x.store_slug is null or c.store_slug=x.store_slug)
    and (x.min_price is null or c.price>=x.min_price)
    and (x.max_price is null or c.price<=x.max_price)
    and (x.only_images is false or c.image_url is not null)
    and (x.filter_group is null or c.effective_filter_group=x.filter_group)
    and (x.semantic_group is null or c.effective_filter_group=x.semantic_group)
    and (x.region_code is null or coalesce(c.coverage_scope,'national')='national' or c.region_code is null or upper(c.region_code)=x.region_code)
    and (x.city_name is null or c.city_name is null or public.normalize_text(c.city_name)=x.city_name)
    and (
      x.query_text is null
      or (x.semantic_tag is not null and public.public_semantic_offer_matches(x.semantic_tag,c.semantic_tags,c.title,c.product_quantity_text))
      or (
        x.semantic_tag is null
        and (
          c.normalized_product_search like '%'||x.query_text||'%'
          or similarity(c.normalized_product_search,x.query_text)>=0.24
          or public.normalize_text(c.store_name) like '%'||x.query_text||'%'
          or public.normalize_text(c.category_name) like '%'||x.query_text||'%'
        )
      )
    )
),
rows as (
  select f.*,
         x.today as sort_today,
         x.sort_mode as sort_mode,
         count(*) over()::bigint result_count
  from filtered f
  cross join params x
  order by
    (f.valid_from>x.today) asc,
    case when x.sort_mode='discount' then (case when f.old_price>0 and f.price>0 then (1-f.price/f.old_price)*100 else 0 end) end desc nulls last,
    case when x.sort_mode='newest' then f.published_at end desc nulls last,
    case when x.sort_mode='priceAsc' then f.price end asc nulls last,
    case when x.sort_mode='priceDesc' then f.price end desc nulls last,
    case when x.sort_mode='ending' then f.valid_to end asc nulls last,
    case when x.sort_mode='saving' then greatest(coalesce(f.old_price,0)-coalesce(f.price,0),0) end desc nulls last,
    case when x.sort_mode='name' then f.title end asc nulls last,
    case when x.sort_mode='recommended' then (
      case when f.old_price>0 and f.price>0 then (1-f.price/f.old_price)*200 else 0 end
      + least(greatest(coalesce(f.old_price,0)-coalesce(f.price,0),0),100)
    ) end desc nulls last,
    f.published_at desc nulls last,
    f.offer_id
  limit (select row_limit from params)
  offset (select row_offset from params)
)
select jsonb_build_object(
  'id',r.offer_id,'product_id',r.product_id,'store_id',r.store_id,'category_id',r.category_id,
  'title',r.title,'description',r.description,'price',r.price,'old_price',r.old_price,'image_url',r.image_url,
  'valid_from',r.valid_from,'valid_to',r.valid_to,'published_at',r.published_at,'coverage_scope',r.coverage_scope,
  'region_code',r.region_code,'city_name',r.city_name,'store_location_name',r.store_location_name,
  'is_verified',r.is_verified,'metadata',r.metadata,
  'stores',jsonb_build_object('name',r.store_name,'slug',r.store_slug,'logo_url',r.store_logo_url,'primary_color',r.store_primary_color),
  'products',jsonb_build_object(
    'name',r.product_name,'brand',r.product_brand,'quantity_text',r.product_quantity_text,'image_url',r.product_image_url,
    'filter_group',r.effective_filter_group,'filter_tags',r.product_filter_tags,'content_form',r.product_content_form,
    'classification_confidence',r.product_classification_confidence
  ),
  'categories',case when r.category_name is null then null else jsonb_build_object('name',r.category_name,'slug',r.category_slug) end
),r.result_count
from rows r
order by
  (r.valid_from>r.sort_today) asc,
  case when r.sort_mode='discount' then (case when r.old_price>0 and r.price>0 then (1-r.price/r.old_price)*100 else 0 end) end desc nulls last,
  case when r.sort_mode='newest' then r.published_at end desc nulls last,
  case when r.sort_mode='priceAsc' then r.price end asc nulls last,
  case when r.sort_mode='priceDesc' then r.price end desc nulls last,
  case when r.sort_mode='ending' then r.valid_to end asc nulls last,
  case when r.sort_mode='saving' then greatest(coalesce(r.old_price,0)-coalesce(r.price,0),0) end desc nulls last,
  case when r.sort_mode='name' then r.title end asc nulls last,
  case when r.sort_mode='recommended' then (
    case when r.old_price>0 and r.price>0 then (1-r.price/r.old_price)*200 else 0 end
    + least(greatest(coalesce(r.old_price,0)-coalesce(r.price,0),0),100)
  ) end desc nulls last,
  r.published_at desc nulls last,
  r.offer_id;
$function$;