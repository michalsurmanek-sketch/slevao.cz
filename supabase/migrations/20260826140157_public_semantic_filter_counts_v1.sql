create or replace function public.get_public_semantic_filter_counts(
  p_queries text[],
  p_include_upcoming boolean default true,
  p_store_slug text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_only_images boolean default false,
  p_filter_group text default null,
  p_region_code text default null,
  p_city_name text default null
)
returns table(query text, total_count bigint)
language sql
stable
set search_path = 'public'
set plan_cache_mode = 'force_custom_plan'
as $function$
with params as materialized (
  select
    (timezone('Europe/Prague', now()))::date as today,
    nullif(trim(lower(coalesce(p_store_slug,''))),'') as store_slug,
    nullif(trim(lower(coalesce(p_filter_group,''))),'') as filter_group,
    nullif(trim(upper(coalesce(p_region_code,''))),'') as region_code,
    nullif(trim(public.normalize_text(coalesce(p_city_name,''))),'') as city_name,
    case when p_min_price is null or p_min_price < 0 then null else p_min_price end as min_price,
    case when p_max_price is null or p_max_price < 0 then null else p_max_price end as max_price,
    coalesce(p_only_images,false) as only_images
),
queries as materialized (
  select
    u.query,
    u.ord,
    public.public_semantic_query_tag(u.query) as semantic_tag,
    public.public_semantic_tag_filter_group(public.public_semantic_query_tag(u.query)) as semantic_group
  from unnest(coalesce(p_queries,'{}'::text[])) with ordinality as u(query,ord)
  where nullif(trim(u.query),'') is not null
),
common as materialized (
  select
    c.semantic_tags,
    c.title,
    c.product_quantity_text,
    c.effective_filter_group
  from private.public_offer_search_cache c
  cross join params x
  where c.valid_to >= x.today
    and c.valid_from <= case when p_include_upcoming then x.today + 7 else x.today end
    and (x.store_slug is null or c.store_slug = x.store_slug)
    and (x.min_price is null or c.price >= x.min_price)
    and (x.max_price is null or c.price <= x.max_price)
    and (x.only_images is false or c.image_url is not null)
    and (x.filter_group is null or c.effective_filter_group = x.filter_group)
    and (x.region_code is null or coalesce(c.coverage_scope,'national') = 'national' or c.region_code is null or upper(c.region_code) = x.region_code)
    and (x.city_name is null or c.city_name is null or public.normalize_text(c.city_name) = x.city_name)
),
counts as (
  select
    q.ord,
    q.query,
    count(c.*)::bigint as total_count
  from queries q
  left join common c
    on q.semantic_tag is not null
   and (q.semantic_group is null or c.effective_filter_group = q.semantic_group)
   and public.public_semantic_offer_matches(q.semantic_tag,c.semantic_tags,c.title,c.product_quantity_text)
  group by q.ord,q.query
)
select query,total_count
from counts
order by ord;
$function$;

revoke all on function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) from public;
grant execute on function public.get_public_semantic_filter_counts(text[],boolean,text,numeric,numeric,boolean,text,text,text) to anon, authenticated;