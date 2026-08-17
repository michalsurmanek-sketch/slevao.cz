create or replace function public.search_public_offers(
  p_query text,
  p_limit integer default 24,
  p_offset integer default 0,
  p_store_slug text default null,
  p_include_upcoming boolean default true
)
returns table(offer jsonb, total_count bigint, search_score numeric)
language plpgsql
stable
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  v_q text;
  v_relaxed text;
  v_limit integer := greatest(1,least(coalesce(p_limit,24),100));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_store_filter text := nullif(trim(lower(coalesce(p_store_slug,''))),'');
  v_store_clause text := '';
  v_horizon integer := case when p_include_upcoming then 7 else 0 end;
  v_sql text;
begin
  v_q := trim(regexp_replace(lower(public.unaccent(coalesce(p_query,''))), '[^a-z0-9]+',' ','g'));
  if v_q='' then return; end if;

  v_relaxed := case
    when v_q ~ '([a-z])\1$' then regexp_replace(v_q,'([a-z])\1$','\1')
    when v_q ~ 'icka$' then regexp_replace(v_q,'ka$','')
    else v_q
  end;

  if v_store_filter is not null then
    v_store_clause := format(' and s.slug=%L ',v_store_filter);
  end if;

  v_sql := format($sql$
    with candidate_ids as (
      select o.id
      from public.offers o
      where o.status='published'
        and o.is_verified is true
        and o.valid_to >= (timezone('Europe/Prague',now()))::date
        and o.valid_from <= (timezone('Europe/Prague',now()))::date + %s
        and (
          o.normalized_title ilike '%%' || %L || '%%'
          %s
          or o.normalized_title %% %L
        )
    ), ranked as (
      select o.*,s.name as store_name,s.slug as store_slug,s.logo_url as store_logo_url,s.primary_color as store_primary_color,
        p.name as product_name,p.brand as product_brand,p.quantity_text as product_quantity_text,p.image_url as product_image_url,
        p.filter_group as product_filter_group,p.filter_tags as product_filter_tags,p.content_form as product_content_form,
        p.classification_confidence as product_classification_confidence,c.name as category_name,c.slug as category_slug,
        coalesce(o.normalized_title,trim(regexp_replace(lower(public.unaccent(coalesce(nullif(o.title,''),p.name,''))),'[^a-z0-9]+',' ','g'))) as search_title,
        row_number() over (
          partition by s.slug,
            trim(regexp_replace(regexp_replace(lower(public.unaccent(coalesce(nullif(o.title,''),p.name,''))), '\m[0-9]+([.,][0-9]+)?[[:space:]]*(g|kg|ml|l|ks|bal|baleni)\M','','gi'),'[^a-z0-9]+',' ','g')),
            o.valid_from,o.valid_to
          order by (coalesce(o.image_url,p.image_url) is not null) desc,o.published_at desc nulls last,o.updated_at desc nulls last,o.id
        ) as dedupe_rank
      from candidate_ids ci
      join public.offers o on o.id=ci.id
      join public.stores s on s.id=o.store_id and s.is_active is true
      left join public.products p on p.id=o.product_id
      left join public.categories c on c.id=coalesce(o.category_id,p.category_id)
      where true %s
    ), dedup as (
      select * from ranked where dedupe_rank=1
    ), scored as (
      select d.*,
        greatest(
          case when d.search_title=%L then 1.0 else 0 end,
          case when d.search_title like %L||'%%' then 0.96 else 0 end,
          case when d.search_title like '%% '||%L||'%%' then 0.92 else 0 end,
          case when d.search_title like '%%'||%L||'%%' then 0.86 else 0 end,
          similarity(d.search_title,%L)
        )::numeric as score
      from dedup d
    ), counted as (
      select z.*,count(*) over()::bigint as result_count from scored z where score>=0.24
    )
    select jsonb_build_object(
      'id',id,'product_id',product_id,'store_id',store_id,'category_id',category_id,'title',title,'description',description,
      'price',price,'old_price',old_price,'image_url',coalesce(image_url,product_image_url),'valid_from',valid_from,'valid_to',valid_to,
      'published_at',published_at,'coverage_scope',coverage_scope,'region_code',region_code,'city_name',city_name,'store_location_name',store_location_name,
      'is_verified',is_verified,'metadata',metadata,
      'stores',jsonb_build_object('name',store_name,'slug',store_slug,'logo_url',store_logo_url,'primary_color',store_primary_color),
      'products',jsonb_build_object('name',product_name,'brand',product_brand,'quantity_text',product_quantity_text,'image_url',product_image_url,'filter_group',product_filter_group,'filter_tags',product_filter_tags,'content_form',product_content_form,'classification_confidence',product_classification_confidence),
      'categories',case when category_name is null then null else jsonb_build_object('name',category_name,'slug',category_slug) end
    ) as offer,
    result_count as total_count,
    round(score,4) as search_score
    from counted
    order by score desc,(valid_from>(timezone('Europe/Prague',now()))::date) asc,coalesce(discount_percent,0) desc,coalesce(deal_score,0) desc,published_at desc nulls last,id
    limit %s offset %s
  $sql$,
    v_horizon,
    v_q,
    case when v_relaxed<>v_q then format(' or o.normalized_title ilike ''%%'' || %L || ''%%'' ',v_relaxed) else '' end,
    v_q,
    v_store_clause,
    v_q,v_q,v_q,v_q,v_q,
    v_limit,v_offset
  );

  return query execute v_sql;
end;
$function$;

grant execute on function public.search_public_offers(text,integer,integer,text,boolean) to anon, authenticated, service_role;

drop function if exists private.search_public_offers_fast_test(text,integer,integer,text,boolean);
