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
         public.public_semantic_query_tag(p_query) semantic_tag,
         set_config('pg_trgm.similarity_threshold','0.24',true) trigram_threshold
),
matched as materialized (
  select x.today,x.sort_mode,x.mode,
         c.offer_id,c.valid_from,c.valid_to,c.price,c.old_price,c.published_at,c.title
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
    and (
      x.query_text is null
      or (x.semantic_tag is not null and c.semantic_tags @> array[x.semantic_tag])
      or (
        x.semantic_tag is null
        and (
          c.normalized_search like '%'||x.query_text||'%'
          or c.normalized_product_search % x.query_text
        )
      )
    )
    and (
      x.mode='all'
      or (x.mode='recommended' and c.store_slug in ('albert','billa','coop','globus','kaufland','lidl','penny','tesco'))
      or (x.mode='food' and c.effective_filter_group='food')
      or (x.mode='ending' and c.valid_to=x.today)
      or (x.mode='under50' and c.price<=50)
      or (x.mode='under100' and c.price<=100)
      or x.mode in ('discount','new')
    )
),
total as (
  select count(*)::bigint total_count from matched
),
page_ids as (
  select m.offer_id,m.today,m.sort_mode,m.mode,m.valid_from,m.valid_to,m.price,m.old_price,m.published_at,m.title
  from matched m
  order by
    (m.valid_from>m.today) asc,
    case when (m.mode='discount' or m.sort_mode='discount') then (case when m.old_price>0 and m.price>0 then (1-m.price/m.old_price)*100 else 0 end) end desc nulls last,
    case when (m.mode='new' or m.sort_mode='newest') then m.published_at end desc nulls last,
    case when m.sort_mode='priceAsc' then m.price end asc nulls last,
    case when m.sort_mode='priceDesc' then m.price end desc nulls last,
    case when m.sort_mode='ending' then m.valid_to end asc nulls last,
    case when m.sort_mode='saving' then greatest(coalesce(m.old_price,0)-coalesce(m.price,0),0) end desc nulls last,
    case when m.sort_mode='name' then m.title end asc nulls last,
    case when m.sort_mode='recommended' and m.mode not in ('discount','new') then (
      case when m.old_price>0 and m.price>0 then (1-m.price/m.old_price)*200 else 0 end
      + least(greatest(coalesce(m.old_price,0)-coalesce(m.price,0),0),100)
    ) end desc nulls last,
    m.published_at desc nulls last,
    m.offer_id
  limit (select row_limit from params)
  offset (select row_offset from params)
)
select jsonb_build_object(
  'id',pg.offer_id,'product_id',pg.product_id,'store_id',pg.store_id,'category_id',pg.category_id,
  'title',pg.title,'description',pg.description,'price',pg.price,'old_price',pg.old_price,'image_url',pg.image_url,
  'valid_from',pg.valid_from,'valid_to',pg.valid_to,'published_at',pg.published_at,'coverage_scope',pg.coverage_scope,
  'region_code',pg.region_code,'city_name',pg.city_name,'store_location_name',pg.store_location_name,'is_verified',pg.is_verified,'metadata',pg.metadata,
  'stores',jsonb_build_object('name',pg.store_name,'slug',pg.store_slug,'logo_url',pg.store_logo_url,'primary_color',pg.store_primary_color),
  'products',jsonb_build_object(
    'name',pg.product_name,'brand',pg.product_brand,'quantity_text',pg.product_quantity_text,'image_url',pg.product_image_url,
    'filter_group',pg.effective_filter_group,'filter_tags',pg.product_filter_tags,'content_form',pg.product_content_form,
    'classification_confidence',pg.product_classification_confidence
  ),
  'categories',case when pg.category_name is null then null else jsonb_build_object('name',pg.category_name,'slug',pg.category_slug) end
),
t.total_count
from page_ids p
join private.public_offer_search_cache pg on pg.offer_id=p.offer_id
cross join total t
order by
  (p.valid_from>p.today) asc,
  case when (p.mode='discount' or p.sort_mode='discount') then (case when p.old_price>0 and p.price>0 then (1-p.price/p.old_price)*100 else 0 end) end desc nulls last,
  case when (p.mode='new' or p.sort_mode='newest') then p.published_at end desc nulls last,
  case when p.sort_mode='priceAsc' then p.price end asc nulls last,
  case when p.sort_mode='priceDesc' then p.price end desc nulls last,
  case when p.sort_mode='ending' then p.valid_to end asc nulls last,
  case when p.sort_mode='saving' then greatest(coalesce(p.old_price,0)-coalesce(p.price,0),0) end desc nulls last,
  case when p.sort_mode='name' then p.title end asc nulls last,
  case when p.sort_mode='recommended' and p.mode not in ('discount','new') then (
    case when p.old_price>0 and p.price>0 then (1-p.price/p.old_price)*200 else 0 end
    + least(greatest(coalesce(p.old_price,0)-coalesce(p.price,0),0),100)
  ) end desc nulls last,
  p.published_at desc nulls last,
  p.offer_id;
$function$;

create or replace function public.get_public_offer_facets(
  p_include_upcoming boolean default true,
  p_store_slug text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_only_images boolean default false,
  p_query text default null,
  p_filter_group text default null,
  p_region_code text default null,
  p_city_name text default null,
  p_mode text default 'all'
)
returns jsonb
language sql
stable
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $function$
with params as materialized (
  select (timezone('Europe/Prague',now()))::date today,
         nullif(trim(lower(coalesce(p_store_slug,''))),'') store_slug,
         nullif(trim(public.normalize_text(coalesce(p_query,''))),'') query_text,
         nullif(trim(lower(coalesce(p_filter_group,''))),'') filter_group,
         nullif(trim(upper(coalesce(p_region_code,''))),'') region_code,
         nullif(trim(public.normalize_text(coalesce(p_city_name,''))),'') city_name,
         case when p_min_price is null or p_min_price<0 then null else p_min_price end min_price,
         case when p_max_price is null or p_max_price<0 then null else p_max_price end max_price,
         coalesce(p_only_images,false) only_images,
         case when p_mode in ('all','recommended','food','ending','under50','under100','discount','new') then p_mode else 'all' end mode,
         public.public_semantic_query_tag(p_query) semantic_tag,
         set_config('pg_trgm.similarity_threshold','0.24',true) trigram_threshold
),
common as materialized (
  select c.valid_from,
         c.store_id,c.store_name,c.store_slug,c.store_logo_url,c.store_primary_color,
         c.effective_filter_group
  from private.public_offer_search_cache c
  cross join params x
  where c.valid_to>=x.today
    and c.valid_from<=case when p_include_upcoming then x.today+7 else x.today end
    and (x.min_price is null or c.price>=x.min_price)
    and (x.max_price is null or c.price<=x.max_price)
    and (x.only_images is false or c.image_url is not null)
    and (x.region_code is null or coalesce(c.coverage_scope,'national')='national' or c.region_code is null or upper(c.region_code)=x.region_code)
    and (x.city_name is null or c.city_name is null or public.normalize_text(c.city_name)=x.city_name)
    and (
      x.query_text is null
      or (x.semantic_tag is not null and c.semantic_tags @> array[x.semantic_tag])
      or (
        x.semantic_tag is null
        and (
          c.normalized_search like '%'||x.query_text||'%'
          or c.normalized_product_search % x.query_text
        )
      )
    )
    and (
      x.mode='all'
      or (x.mode='recommended' and c.store_slug in ('albert','billa','coop','globus','kaufland','lidl','penny','tesco'))
      or (x.mode='food' and c.effective_filter_group='food')
      or (x.mode='ending' and c.valid_to=x.today)
      or (x.mode='under50' and c.price<=50)
      or (x.mode='under100' and c.price<=100)
      or x.mode in ('discount','new')
    )
),
total_rows as (
  select count(*)::bigint total,
         count(*) filter(where c.valid_from<=x.today)::bigint current_count,
         count(*) filter(where c.valid_from>x.today)::bigint upcoming_count
  from common c cross join params x
  where (x.store_slug is null or c.store_slug=x.store_slug)
    and (x.filter_group is null or c.effective_filter_group=x.filter_group)
),
store_rows as (
  select c.store_id,c.store_name,c.store_slug,c.store_logo_url,c.store_primary_color,count(*)::bigint count
  from common c cross join params x
  where (x.filter_group is null or c.effective_filter_group=x.filter_group)
  group by c.store_id,c.store_name,c.store_slug,c.store_logo_url,c.store_primary_color
  order by count desc,c.store_name
),
group_rows as (
  select c.effective_filter_group filter_group,count(*)::bigint count
  from common c cross join params x
  where (x.store_slug is null or c.store_slug=x.store_slug)
  group by c.effective_filter_group
  order by count desc,c.effective_filter_group
)
select jsonb_build_object(
  'total',t.total,
  'current_count',t.current_count,
  'upcoming_count',t.upcoming_count,
  'stores',coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',s.store_id,'name',s.store_name,'slug',s.store_slug,
        'logo_url',s.store_logo_url,'primary_color',s.store_primary_color,'count',s.count
      ) order by s.count desc,s.store_name
    ) from store_rows s
  ),'[]'::jsonb),
  'groups',coalesce((
    select jsonb_agg(
      jsonb_build_object('filter_group',g.filter_group,'count',g.count)
      order by g.count desc,g.filter_group
    ) from group_rows g
  ),'[]'::jsonb)
)
from total_rows t;
$function$;
