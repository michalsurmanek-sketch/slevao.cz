create or replace function public.get_public_offer_page_filtered(
  p_limit integer default 24,
  p_offset integer default 0,
  p_include_upcoming boolean default true,
  p_store_slug text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_only_images boolean default false,
  p_sort text default 'recommended',
  p_query text default null,
  p_filter_group text default null,
  p_region_code text default null,
  p_city_name text default null,
  p_mode text default 'all'
)
returns table(offer jsonb, total_count bigint)
language sql
stable
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
with params as materialized (
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
         case when p_mode in ('all','recommended','food','ending','under50','under100','discount','new') then p_mode else 'all' end mode,
         public.public_semantic_query_tag(p_query) semantic_tag
), matched as materialized (
  select c.offer_id,c.valid_from,c.valid_to,c.price,c.old_price,c.published_at,c.title,
         c.store_slug,c.effective_filter_group,c.coverage_scope,c.region_code,c.city_name,c.image_url,
         c.normalized_product_search,c.semantic_tags,c.store_name,c.category_name
  from private.public_offer_search_cache c
  cross join params x
  where c.valid_to>=x.today
    and c.valid_from<=case when p_include_upcoming then x.today+7 else x.today end
    and (x.store_slug is null or c.store_slug=x.store_slug)
    and (x.min_price is null or c.price>=x.min_price)
    and (x.max_price is null or c.price<=x.max_price)
    and (x.only_images is false or c.image_url is not null)
    and (x.filter_group is null or c.effective_filter_group=x.filter_group)
    and (x.region_code is null or coalesce(c.coverage_scope,'national')='national' or c.region_code is null or upper(c.region_code)=x.region_code)
    and (x.city_name is null or c.city_name is null or public.normalize_text(c.city_name)=x.city_name)
    and (x.query_text is null or
         (x.semantic_tag is not null and c.semantic_tags @> array[x.semantic_tag]) or
         (x.semantic_tag is null and (
           c.normalized_product_search like '%'||x.query_text||'%'
           or similarity(c.normalized_product_search,x.query_text)>=0.24
           or public.normalize_text(c.store_name) like '%'||x.query_text||'%'
           or public.normalize_text(c.category_name) like '%'||x.query_text||'%'
         )))
    and (x.mode='all'
         or (x.mode='recommended' and c.store_slug in ('albert','billa','coop','globus','kaufland','lidl','penny','tesco'))
         or (x.mode='food' and c.effective_filter_group='food')
         or (x.mode='ending' and c.valid_to=x.today)
         or (x.mode='under50' and c.price<=50)
         or (x.mode='under100' and c.price<=100)
         or x.mode in ('discount','new'))
), ranked as materialized (
  select m.offer_id,
         count(*) over()::bigint result_count,
         row_number() over (
           order by (m.valid_from>x.today) asc,
             case when (x.mode='discount' or x.sort_mode='discount') then
               (case when m.old_price>0 and m.price>0 then (1-m.price/m.old_price)*100 else 0 end)
             end desc nulls last,
             case when (x.mode='new' or x.sort_mode='newest') then m.published_at end desc nulls last,
             case when x.sort_mode='priceAsc' then m.price end asc nulls last,
             case when x.sort_mode='priceDesc' then m.price end desc nulls last,
             case when x.sort_mode='ending' then m.valid_to end asc nulls last,
             case when x.sort_mode='saving' then greatest(coalesce(m.old_price,0)-coalesce(m.price,0),0) end desc nulls last,
             case when x.sort_mode='name' then m.title end asc nulls last,
             case when x.sort_mode='recommended' and x.mode not in ('discount','new') then
               (case when m.old_price>0 and m.price>0 then (1-m.price/m.old_price)*200 else 0 end
                + least(greatest(coalesce(m.old_price,0)-coalesce(m.price,0),0),100))
             end desc nulls last,
             m.published_at desc nulls last,m.offer_id
         ) rn
  from matched m cross join params x
), page_ids as (
  select r.offer_id,r.result_count,r.rn
  from ranked r cross join params x
  where r.rn>x.row_offset and r.rn<=x.row_offset+x.row_limit
)
select jsonb_build_object(
  'id',c.offer_id,'product_id',c.product_id,'store_id',c.store_id,'category_id',c.category_id,
  'title',c.title,'description',c.description,'price',c.price,'old_price',c.old_price,'image_url',c.image_url,
  'valid_from',c.valid_from,'valid_to',c.valid_to,'published_at',c.published_at,'coverage_scope',c.coverage_scope,
  'region_code',c.region_code,'city_name',c.city_name,'store_location_name',c.store_location_name,'is_verified',c.is_verified,'metadata',c.metadata,
  'stores',jsonb_build_object('name',c.store_name,'slug',c.store_slug,'logo_url',c.store_logo_url,'primary_color',c.store_primary_color),
  'products',jsonb_build_object('name',c.product_name,'brand',c.product_brand,'quantity_text',c.product_quantity_text,'image_url',c.product_image_url,
    'filter_group',c.effective_filter_group,'filter_tags',c.product_filter_tags,'content_form',c.product_content_form,'classification_confidence',c.product_classification_confidence),
  'categories',case when c.category_name is null then null else jsonb_build_object('name',c.category_name,'slug',c.category_slug) end
),p.result_count
from page_ids p
join private.public_offer_search_cache c on c.offer_id=p.offer_id
order by p.rn;
$function$;
