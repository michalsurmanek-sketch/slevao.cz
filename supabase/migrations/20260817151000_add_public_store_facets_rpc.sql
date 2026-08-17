create or replace function public.get_public_store_facets(p_include_upcoming boolean default true)
returns table(store_id uuid,store_name text,store_slug text,logo_url text,primary_color text,current_count bigint,upcoming_count bigint,total_count bigint)
language sql
stable
security invoker
set search_path=public
as $$
with params as (
  select (timezone('Europe/Prague',now()))::date as today
), ranked as (
  select o.id,o.store_id,o.valid_from,o.valid_to,s.name as store_name,s.slug as store_slug,s.logo_url,s.primary_color,
    row_number() over (
      partition by s.slug,
        trim(regexp_replace(regexp_replace(lower(public.unaccent(coalesce(nullif(o.title,''),p.name,''))), '\m[0-9]+([.,][0-9]+)?[[:space:]]*(g|kg|ml|l|ks|bal|baleni)\M','','gi'),'[^a-z0-9]+',' ','g')),
        o.valid_from,o.valid_to
      order by (coalesce(o.image_url,p.image_url) is not null) desc,o.published_at desc nulls last,o.updated_at desc nulls last,o.id
    ) as dedupe_rank
  from public.offers o
  join public.stores s on s.id=o.store_id and s.is_active is true
  left join public.products p on p.id=o.product_id
  cross join params x
  where o.status='published' and o.is_verified is true and o.valid_to>=x.today
    and o.valid_from<=case when p_include_upcoming then x.today+7 else x.today end
), dedup as (
  select * from ranked where dedupe_rank=1
)
select d.store_id,max(d.store_name)::text,max(d.store_slug)::text,max(d.logo_url)::text,max(d.primary_color)::text,
  count(*) filter (where d.valid_from<=x.today and d.valid_to>=x.today)::bigint,
  count(*) filter (where d.valid_from>x.today)::bigint,
  count(*)::bigint
from dedup d cross join params x
group by d.store_id
order by count(*) desc,max(d.store_name);
$$;

grant execute on function public.get_public_store_facets(boolean) to anon,authenticated,service_role;
