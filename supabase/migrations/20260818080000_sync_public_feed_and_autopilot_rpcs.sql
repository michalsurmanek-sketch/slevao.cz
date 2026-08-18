-- Sync production RPCs introduced during the 2026-08-18 stabilization pass.
-- Keep public read paths explicit and reproducible from source control.

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

create or replace function public.get_public_shopping_list_candidates(
  p_queries text[],
  p_limit_per_query integer default 30
)
returns table(
  query_text text,
  query_key text,
  candidate_rank integer,
  offer jsonb,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
with input as (
  select trim(q.value) as query_text,
         public.normalize_text(trim(q.value)) as query_key,
         min(q.ordinality)::int as first_position
  from unnest(coalesce(p_queries, '{}'::text[])) with ordinality as q(value, ordinality)
  where nullif(trim(q.value), '') is not null
  group by trim(q.value), public.normalize_text(trim(q.value))
  order by min(q.ordinality)
  limit 20
), candidates as (
  select i.query_text,
         i.query_key,
         row_number() over (
           partition by i.query_key
           order by (o.offer->>'price')::numeric nulls last,
                    o.offer->>'valid_from',
                    o.offer->>'id'
         )::int as candidate_rank,
         o.offer,
         o.total_count
  from input i
  cross join lateral public.get_public_offer_page_filtered(
    greatest(1, least(coalesce(p_limit_per_query, 30), 60)),
    0,
    true,
    null, null, null, false,
    'priceAsc',
    i.query_text,
    null, null, null,
    'all'
  ) o
)
select query_text, query_key, candidate_rank, offer, total_count
from candidates
order by query_key, candidate_rank;
$$;

revoke all on function public.get_public_shopping_list_candidates(text[], integer) from public;
grant execute on function public.get_public_shopping_list_candidates(text[], integer) to anon, authenticated, service_role;

create or replace function public.get_shared_shopping_list_revision(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share record;
  v_count bigint;
  v_max_updated timestamptz;
  v_max_created timestamptz;
  v_revision text;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;

  select count(*)::bigint, max(updated_at), max(created_at)
    into v_count, v_max_updated, v_max_created
  from public.shopping_list_items
  where shopping_list_id = v_share.shopping_list_id;

  v_revision := concat_ws(':',
    v_count::text,
    coalesce(extract(epoch from v_max_updated)::bigint, 0)::text,
    coalesce(extract(epoch from v_max_created)::bigint, 0)::text
  );

  return jsonb_build_object(
    'list_id', v_share.shopping_list_id,
    'permission', v_share.permission,
    'item_count', v_count,
    'updated_at', v_max_updated,
    'revision', v_revision
  );
end;
$$;

revoke all on function public.get_shared_shopping_list_revision(text) from public;
grant execute on function public.get_shared_shopping_list_revision(text) to anon, authenticated, service_role;

create or replace function public.get_shared_shopping_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share record;
  v_result jsonb;
  v_count bigint;
  v_max_updated timestamptz;
  v_max_created timestamptz;
  v_revision text;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;

  update public.shopping_list_shares
  set last_accessed_at = now()
  where id = v_share.share_id;

  select count(*)::bigint, max(updated_at), max(created_at)
    into v_count, v_max_updated, v_max_created
  from public.shopping_list_items
  where shopping_list_id = v_share.shopping_list_id;

  v_revision := concat_ws(':',
    v_count::text,
    coalesce(extract(epoch from v_max_updated)::bigint, 0)::text,
    coalesce(extract(epoch from v_max_created)::bigint, 0)::text
  );

  select jsonb_build_object(
    'list_id', v_share.shopping_list_id,
    'name', v_share.list_name,
    'permission', v_share.permission,
    'budget', sl.budget,
    'revision', v_revision,
    'updated_at', v_max_updated,
    'item_count', v_count,
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'product_id', i.product_id,
        'selected_offer_id', i.selected_offer_id,
        'custom_name', i.custom_name,
        'quantity', i.quantity,
        'unit', i.unit,
        'is_completed', i.is_completed,
        'created_at', i.created_at,
        'updated_at', i.updated_at,
        'name', coalesce(p.name, i.custom_name, 'Položka'),
        'brand', p.brand,
        'quantity_text', p.quantity_text,
        'image_url', p.image_url
      ) order by i.created_at
    ) filter (where i.id is not null), '[]'::jsonb)
  ) into v_result
  from public.shopping_lists sl
  left join public.shopping_list_items i on i.shopping_list_id = sl.id
  left join public.products p on p.id = i.product_id
  where sl.id = v_share.shopping_list_id
  group by sl.id;

  return v_result;
end;
$$;

revoke all on function public.get_shared_shopping_list(text) from public;
grant execute on function public.get_shared_shopping_list(text) to anon, authenticated, service_role;

-- The view is public read-only data, but must honor the caller's RLS/privileges.
alter view public.public_store_feed_health set (security_invoker = true);
