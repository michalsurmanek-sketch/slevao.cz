create or replace function public.search_public_offers(
  p_query text,
  p_limit integer default 24,
  p_offset integer default 0,
  p_store_slug text default null,
  p_include_upcoming boolean default true
)
returns table(offer jsonb, total_count bigint, search_score numeric)
language sql
stable
set search_path = public
as $$
  with params as (
    select
      trim(regexp_replace(lower(public.unaccent(coalesce(p_query,''))), '[^a-z0-9]+', ' ', 'g')) as q,
      greatest(1, least(coalesce(p_limit,24),100)) as row_limit,
      greatest(coalesce(p_offset,0),0) as row_offset,
      nullif(trim(lower(coalesce(p_store_slug,''))),'') as store_filter,
      (timezone('Europe/Prague',now()))::date as today
  ),
  ranked as (
    select
      o.*, s.name as store_name, s.slug as store_slug, s.logo_url as store_logo_url,
      s.primary_color as store_primary_color, p.name as product_name, p.brand as product_brand,
      p.quantity_text as product_quantity_text, p.image_url as product_image_url,
      p.filter_group as product_filter_group, p.filter_tags as product_filter_tags,
      p.content_form as product_content_form, p.classification_confidence as product_classification_confidence,
      c.name as category_name, c.slug as category_slug,
      trim(regexp_replace(lower(public.unaccent(coalesce(nullif(o.title,''),p.name,''))), '[^a-z0-9]+',' ','g')) as search_title,
      trim(regexp_replace(lower(public.unaccent(coalesce(p.brand,''))), '[^a-z0-9]+',' ','g')) as search_brand,
      row_number() over (
        partition by s.slug,
          trim(regexp_replace(regexp_replace(lower(public.unaccent(coalesce(nullif(o.title,''),p.name,''))), '\m[0-9]+([.,][0-9]+)?[[:space:]]*(g|kg|ml|l|ks|bal|baleni)\M','','gi'),'[^a-z0-9]+',' ','g')),
          o.valid_from,o.valid_to
        order by (coalesce(o.image_url,p.image_url) is not null) desc,o.published_at desc nulls last,o.updated_at desc nulls last,o.id
      ) as dedupe_rank
    from public.offers o
    join public.stores s on s.id=o.store_id and s.is_active is true
    left join public.products p on p.id=o.product_id
    left join public.categories c on c.id=coalesce(o.category_id,p.category_id)
    cross join params x
    where o.status='published' and o.is_verified is true and o.valid_to>=x.today
      and o.valid_from<=case when p_include_upcoming then x.today+7 else x.today end
      and (x.store_filter is null or s.slug=x.store_filter)
  ),
  dedup as (select * from ranked where dedupe_rank=1),
  scored as (
    select d.*,
      greatest(
        case when d.search_title=(select q from params) then 1.0 else 0 end,
        case when d.search_title like (select q from params)||'%' then 0.96 else 0 end,
        case when d.search_title like '% '||(select q from params)||'%' then 0.92 else 0 end,
        case when d.search_title like '%'||(select q from params)||'%' then 0.86 else 0 end,
        case when d.search_brand=(select q from params) then 0.84 else 0 end,
        case when d.search_brand like '%'||(select q from params)||'%' then 0.78 else 0 end,
        similarity(d.search_title,(select q from params)),
        similarity(d.search_brand,(select q from params))*0.85
      )::numeric as score
    from dedup d
    where (select q from params)<>'' and (
      d.search_title like '%'||(select q from params)||'%'
      or d.search_brand like '%'||(select q from params)||'%'
      or similarity(d.search_title,(select q from params))>=0.26
      or similarity(d.search_brand,(select q from params))>=0.32
    )
  ),
  counted as (select s.*,count(*) over()::bigint as result_count from scored s)
  select
    jsonb_build_object(
      'id',id,'product_id',product_id,'store_id',store_id,'category_id',category_id,'title',title,
      'description',description,'price',price,'old_price',old_price,'image_url',coalesce(image_url,product_image_url),
      'valid_from',valid_from,'valid_to',valid_to,'published_at',published_at,'coverage_scope',coverage_scope,
      'region_code',region_code,'city_name',city_name,'store_location_name',store_location_name,'is_verified',is_verified,
      'metadata',metadata,
      'stores',jsonb_build_object('name',store_name,'slug',store_slug,'logo_url',store_logo_url,'primary_color',store_primary_color),
      'products',jsonb_build_object('name',product_name,'brand',product_brand,'quantity_text',product_quantity_text,'image_url',product_image_url,'filter_group',product_filter_group,'filter_tags',product_filter_tags,'content_form',product_content_form,'classification_confidence',product_classification_confidence),
      'categories',case when category_name is null then null else jsonb_build_object('name',category_name,'slug',category_slug) end
    ) as offer,
    result_count as total_count,
    round(score,4) as search_score
  from counted,params
  order by score desc,(valid_from>params.today) asc,coalesce(discount_percent,0) desc,coalesce(deal_score,0) desc,published_at desc nulls last,id
  limit (select row_limit from params)
  offset (select row_offset from params);
$$;

grant execute on function public.search_public_offers(text,integer,integer,text,boolean) to anon, authenticated;
