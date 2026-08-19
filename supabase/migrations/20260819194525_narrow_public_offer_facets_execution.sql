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
with params as (
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
         public.public_semantic_query_tag(p_query) semantic_tag
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
          c.normalized_product_search like '%'||x.query_text||'%'
          or similarity(c.normalized_product_search,x.query_text)>=0.24
          or public.normalize_text(c.store_name) like '%'||x.query_text||'%'
          or public.normalize_text(c.category_name) like '%'||x.query_text||'%'
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
    )
    from store_rows s
  ),'[]'::jsonb),
  'groups',coalesce((
    select jsonb_agg(
      jsonb_build_object('filter_group',g.filter_group,'count',g.count)
      order by g.count desc,g.filter_group
    )
    from group_rows g
  ),'[]'::jsonb)
)
from total_rows t;
$function$;
