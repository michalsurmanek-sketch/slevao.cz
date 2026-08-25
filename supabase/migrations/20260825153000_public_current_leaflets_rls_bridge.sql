-- Let the intentionally public leaflet RPC read published leaflet rows through RLS.
-- The function returns a fixed, bounded projection only; callers cannot supply SQL, store IDs or arbitrary filters.

create or replace function public.get_public_current_leaflets(p_limit integer default 240)
returns table(
  store_id uuid,
  store_slug text,
  store_name text,
  logo_url text,
  leaflet_key text,
  title text,
  valid_from date,
  valid_to date,
  preview_url text,
  source_url text
)
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select (timezone('Europe/Prague', now()))::date as today,
         greatest(1, least(coalesce(p_limit, 240), 500)) as row_limit
), candidates as (
  select li.id, li.store_id, s.slug as store_slug, s.name as store_name, s.logo_url,
         li.source_document_url, li.detected_valid_from, li.detected_valid_to,
         li.created_at, li.updated_at, li.metadata,
         row_number() over (
           partition by li.store_id, coalesce(nullif(li.source_document_url, ''), li.id::text)
           order by li.updated_at desc nulls last, li.created_at desc, li.id
         ) as source_rank
  from public.leaflet_imports li
  join public.stores s on s.id = li.store_id and s.is_active is true
  cross join params p
  where li.status = 'published'
    and coalesce(li.detected_valid_from, p.today) <= p.today
    and coalesce(li.detected_valid_to, p.today) >= p.today
), deduped as (
  select c.*,
         row_number() over (
           partition by c.store_id
           order by c.detected_valid_to asc nulls last,
                    c.detected_valid_from desc nulls last,
                    c.updated_at desc nulls last,
                    c.created_at desc
         ) as store_rank
  from candidates c
  where c.source_rank = 1
), selected as (
  select d.*
  from deduped d
  where d.store_slug <> 'penny' or d.store_rank = 1
  order by d.store_name, d.store_rank, d.detected_valid_to, d.created_at desc
  limit (select row_limit from params)
)
select s.store_id,
       s.store_slug,
       s.store_name,
       s.logo_url,
       s.store_slug || '-' || s.id::text as leaflet_key,
       coalesce(nullif(s.metadata->>'title', ''),
                case when s.store_rank = 1 then 'Aktuální leták' else 'Další platný leták' end) as title,
       s.detected_valid_from as valid_from,
       s.detected_valid_to as valid_to,
       'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/store-leaflet-document?import_id=' || s.id::text as preview_url,
       s.source_document_url as source_url
from selected s;
$$;

revoke all on function public.get_public_current_leaflets(integer) from public;
grant execute on function public.get_public_current_leaflets(integer) to anon, authenticated, service_role;
