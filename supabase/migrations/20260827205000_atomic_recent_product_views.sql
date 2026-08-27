-- Record signed-in product views atomically and safely claim anonymous recent history.

create or replace function public.record_recent_product_view(p_product_id uuid)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Pro uložení historie je nutné přihlášení.';
  end if;

  if p_product_id is null or not exists (
    select 1 from public.products p where p.id = p_product_id
  ) then
    raise exception using errcode = 'P0002', message = 'Produkt nebyl nalezen.';
  end if;

  insert into public.recently_viewed_products(user_id, product_id, last_viewed_at, view_count)
  values (v_user_id, p_product_id, now(), 1)
  on conflict (user_id, product_id) do update
  set last_viewed_at = excluded.last_viewed_at,
      view_count = least(
        2147483647::bigint,
        public.recently_viewed_products.view_count::bigint + 1
      )::integer;
end;
$function$;

create or replace function public.claim_recent_product_views(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Pro převod historie je nutné přihlášení.';
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Historie musí být pole.';
  end if;

  with parsed as (
    select
      case
        when trim(coalesce(r.id, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then trim(r.id)::uuid
        else null
      end as product_id,
      coalesce(r.viewed_at, now()) as viewed_at,
      greatest(1, least(coalesce(r.view_count, 1), 1000000))::integer as view_count
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as r(id text, viewed_at timestamptz, view_count integer)
    limit 30
  ), valid as (
    select p.id as product_id, max(parsed.viewed_at) as viewed_at, max(parsed.view_count) as view_count
    from parsed
    join public.products p on p.id = parsed.product_id
    where parsed.product_id is not null
    group by p.id
  )
  insert into public.recently_viewed_products(user_id, product_id, last_viewed_at, view_count)
  select v_user_id, valid.product_id, valid.viewed_at, valid.view_count
  from valid
  on conflict (user_id, product_id) do update
  set last_viewed_at = greatest(public.recently_viewed_products.last_viewed_at, excluded.last_viewed_at),
      view_count = greatest(public.recently_viewed_products.view_count, excluded.view_count);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.record_recent_product_view(uuid) from public;
revoke all on function public.claim_recent_product_views(jsonb) from public;
grant execute on function public.record_recent_product_view(uuid) to authenticated, service_role;
grant execute on function public.claim_recent_product_views(jsonb) to authenticated, service_role;
