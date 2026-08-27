create or replace function public.validate_shopping_purchase_snapshot()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_purchase_date date := (timezone('Europe/Prague', new.completed_at))::date;
  v_planned numeric := 0;
  v_reference numeric := 0;
  v_store_count integer := 0;
  v_item_count integer := 0;
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception 'Historie nákupu musí obsahovat pole položek.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.items) as item(value)
    where nullif(item.value->>'offer_id', '') is not null
      and not exists (
        select 1
        from public.offers o
        where o.id = (item.value->>'offer_id')::uuid
          and o.status = 'published'
          and o.is_verified = true
          and o.valid_from <= v_purchase_date
          and o.valid_to >= v_purchase_date
          and (
            nullif(item.value->>'product_id', '') is null
            or o.product_id = (item.value->>'product_id')::uuid
          )
          and (
            nullif(item.value->>'price', '') is null
            or abs(o.price - (item.value->>'price')::numeric) <= 0.01
          )
      )
  ) then
    raise exception 'Historie obsahuje nabídku, která v den nákupu nebyla platná nebo nesouhlasí s uloženou cenou.';
  end if;

  select
    count(*)::integer,
    count(distinct nullif(value->>'store_id', ''))::integer,
    coalesce(sum(case when nullif(value->>'subtotal', '') is null then 0 else (value->>'subtotal')::numeric end), 0),
    coalesce(sum(case
      when nullif(value->>'reference_subtotal', '') is not null then (value->>'reference_subtotal')::numeric
      when nullif(value->>'subtotal', '') is not null then (value->>'subtotal')::numeric
      else 0
    end), 0)
  into v_item_count, v_store_count, v_planned, v_reference
  from jsonb_array_elements(new.items);

  new.item_count := v_item_count;
  new.stores_count := v_store_count;
  new.planned_total := round(greatest(v_planned, 0), 2);
  new.reference_total := round(greatest(v_reference, new.planned_total), 2);
  new.savings := round(greatest(new.reference_total - new.planned_total, 0), 2);

  return new;
end;
$function$;
