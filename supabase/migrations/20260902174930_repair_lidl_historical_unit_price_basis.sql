with candidates as (
  select
    ph.id,
    ph.unit_price,
    ph.price,
    regexp_match(p.quantity_text, E'([0-9]+(?:[.,][0-9]+)?)\\s*(g|kg|ml|l)(?:[^[:alpha:]]|$)', 'i') as q
  from public.price_history ph
  join public.stores s on s.id = ph.store_id and s.slug = 'lidl'
  join public.products p on p.id = ph.product_id
  left join public.offers o on o.id = ph.offer_id
  where ph.price > 0
    and ph.unit_price is not null
    and ph.unit_price > 0
    and ph.source_url ilike 'https://assets.leaflets.schwarz/%'
    and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded'
    and (ph.offer_id is null or o.id is null or o.product_id = ph.product_id)
    and p.quantity_text is not null
    and p.quantity_text !~* E'[0-9]+\\s*[x×]\\s*[0-9]'
), calculated as (
  select
    id,
    unit_price,
    case
      when lower(q[2]) = 'g' then price / ((replace(q[1],',','.')::numeric) / 1000)
      when lower(q[2]) = 'kg' then price / replace(q[1],',','.')::numeric
      when lower(q[2]) = 'ml' then price / ((replace(q[1],',','.')::numeric) / 1000)
      when lower(q[2]) = 'l' then price / replace(q[1],',','.')::numeric
    end as expected_unit_price
  from candidates
  where q is not null
)
update public.price_history ph
   set unit_price = ph.unit_price * 10,
       metadata = coalesce(ph.metadata,'{}'::jsonb)
                  || jsonb_build_object(
                       'unit_price_repair', 'lidl_100g_100ml_basis_v1',
                       'unit_price_repaired_at', clock_timestamp(),
                       'unit_price_before_repair', ph.unit_price
                     )
  from calculated c
 where ph.id = c.id
   and c.expected_unit_price > 0
   and c.unit_price / c.expected_unit_price between 0.099 and 0.101;

with candidates as (
  select
    ph.id,
    ph.unit_price,
    ph.price,
    regexp_match(p.quantity_text, E'([0-9]+(?:[.,][0-9]+)?)\\s*(g|kg|ml|l)(?:[^[:alpha:]]|$)', 'i') as q
  from public.price_history ph
  join public.stores s on s.id = ph.store_id and s.slug = 'lidl'
  join public.products p on p.id = ph.product_id
  where ph.offer_id is null
    and ph.price > 0
    and ph.unit_price is not null
    and ph.unit_price > 0
    and ph.source_url ilike 'https://assets.leaflets.schwarz/%'
    and coalesce(nullif(btrim(ph.metadata->>'provenance'),''),'') = ''
    and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded'
    and p.quantity_text is not null
    and p.quantity_text !~* E'[0-9]+\\s*[x×]\\s*[0-9]'
), calculated as (
  select
    id,
    unit_price,
    case
      when lower(q[2]) = 'g' then price / ((replace(q[1],',','.')::numeric) / 1000)
      when lower(q[2]) = 'kg' then price / replace(q[1],',','.')::numeric
      when lower(q[2]) = 'ml' then price / ((replace(q[1],',','.')::numeric) / 1000)
      when lower(q[2]) = 'l' then price / replace(q[1],',','.')::numeric
    end as expected_unit_price
  from candidates
  where q is not null
)
update public.price_history ph
   set metadata = coalesce(ph.metadata,'{}'::jsonb)
                  || jsonb_build_object(
                       'price_history_state', 'quarantined_invalid_unit_math',
                       'quarantined_at', clock_timestamp(),
                       'quarantine_reason', 'Legacy Lidl history row without offer/provenance fails deterministic package unit-price math.'
                     )
  from calculated c
 where ph.id = c.id
   and c.expected_unit_price > 0
   and abs(c.unit_price - c.expected_unit_price) > greatest(0.10, c.expected_unit_price * 0.03);

do $migration$
declare
  v_def text;
  v_old text := $needle$      and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded'$needle$;
  v_new text := $replacement$      and coalesce(ph.metadata->>'product_reassignment_state','') <> 'superseded'
      and coalesce(ph.metadata->>'price_history_state','') not like 'quarantined_%'$replacement$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_public_product_price_history'
  limit 1;

  if strpos(v_def,v_old)=0 then
    raise exception 'Public price history safety predicate not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end
$migration$;
