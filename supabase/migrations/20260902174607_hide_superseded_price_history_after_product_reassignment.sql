create or replace function public.record_offer_price()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_reassigned_from uuid := null;
  v_recorded_at timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    v_reassigned_from := old.product_id;

    update public.price_history ph
       set metadata = coalesce(ph.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                           'product_reassignment_state', 'superseded',
                           'superseded_at', v_recorded_at,
                           'superseded_from_product_id', old.product_id::text,
                           'superseded_to_product_id', new.product_id::text
                         )
     where ph.offer_id = new.id
       and ph.product_id = old.product_id
       and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded';
  end if;

  if tg_op = 'INSERT'
     or new.price is distinct from old.price
     or new.old_price is distinct from old.old_price
     or new.product_id is distinct from old.product_id then

    insert into public.price_history (
      product_id,
      store_id,
      branch_id,
      offer_id,
      price,
      old_price,
      unit_price,
      recorded_at,
      valid_from,
      valid_to,
      source_url,
      metadata
    )
    values (
      new.product_id,
      new.store_id,
      new.branch_id,
      new.id,
      new.price,
      new.old_price,
      new.unit_price,
      v_recorded_at,
      new.valid_from,
      new.valid_to,
      new.source_url,
      jsonb_strip_nulls(jsonb_build_object(
        'provenance', 'offer_trigger',
        'trigger', 'record_offer_price',
        'product_reassignment_state', case when v_reassigned_from is not null then 'current' else null end,
        'reassigned_from_product_id', case when v_reassigned_from is not null then v_reassigned_from::text else null end
      ))
    );
  end if;

  return new;
end;
$function$;

update public.price_history ph
   set metadata = coalesce(ph.metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'product_reassignment_state', 'superseded',
                       'superseded_at', clock_timestamp(),
                       'superseded_from_product_id', ph.product_id::text,
                       'superseded_to_product_id', o.product_id::text
                     )
  from public.offers o
 where o.id = ph.offer_id
   and ph.product_id is distinct from o.product_id
   and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded';

create or replace function public.get_public_product_price_history(p_product_id uuid, p_limit integer default 1000)
returns table(id bigint, product_id uuid, store_id uuid, branch_id uuid, offer_id uuid, price numeric, old_price numeric, unit_price numeric, recorded_at timestamptz, valid_from date, valid_to date, source_url text, store_name text, store_slug text, store_logo_url text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with base as materialized (
    select ph.*
    from public.price_history ph
    where ph.product_id = p_product_id
      and ph.price is not null
      and ph.price > 0
      and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded'
      and (
        ph.offer_id is null
        or not exists (
          select 1 from public.offers current_offer where current_offer.id = ph.offer_id
        )
        or exists (
          select 1
          from public.offers current_offer
          where current_offer.id = ph.offer_id
            and current_offer.product_id = ph.product_id
        )
      )
  ),
  ambiguous as materialized (
    select b.store_id, b.branch_id, b.recorded_at
    from base b
    group by b.store_id, b.branch_id, b.recorded_at
    having count(distinct b.price) > 1
  ),
  safe as materialized (
    select b.*
    from base b
    where not exists (
      select 1
      from ambiguous a
      where a.store_id is not distinct from b.store_id
        and a.branch_id is not distinct from b.branch_id
        and a.recorded_at = b.recorded_at
    )
  ),
  daily_ranked as materialized (
    select
      h.*,
      row_number() over (
        partition by (h.recorded_at at time zone 'Europe/Prague')::date
        order by h.price asc, h.recorded_at desc, h.id desc
      ) as day_rank
    from safe h
  ),
  daily_latest as materialized (
    select d.*
    from daily_ranked d
    where d.day_rank = 1
    order by d.recorded_at desc, d.id desc
    limit greatest(1, least(coalesce(p_limit, 1000), 2000))
  )
  select
    h.id,
    h.product_id,
    h.store_id,
    h.branch_id,
    h.offer_id,
    h.price,
    h.old_price,
    h.unit_price,
    h.recorded_at,
    h.valid_from,
    h.valid_to,
    h.source_url,
    s.name as store_name,
    s.slug as store_slug,
    s.logo_url as store_logo_url
  from daily_latest h
  left join public.stores s on s.id = h.store_id
  order by h.recorded_at asc, h.id asc;
$function$;
