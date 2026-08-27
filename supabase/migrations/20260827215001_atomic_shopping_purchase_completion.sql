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
  v_atomic_completion boolean := false;
  v_current_items jsonb := '[]'::jsonb;
  v_purchase_items jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception 'Historie nákupu musí obsahovat pole položek.';
  end if;

  -- A normal authenticated INSERT means "complete this shopping list". Lock the
  -- parent first so concurrent child INSERTs cannot cross the completion point,
  -- then lock existing children so updates/deletes serialize with this snapshot.
  -- Service-role/admin history writes (auth.uid() is null) keep the old behavior
  -- and never clear a live list as a side effect.
  if tg_op = 'INSERT'
     and new.shopping_list_id is not null
     and auth.uid() is not null then
    if auth.uid() <> new.user_id then
      raise exception 'Dokončit lze pouze vlastní nákupní seznam.';
    end if;

    perform 1
    from public.shopping_lists sl
    where sl.id = new.shopping_list_id
      and sl.user_id = new.user_id
      and sl.is_archived = false
    for update;

    if not found then
      raise exception 'Nákupní seznam už není dostupný nebo nepatří přihlášenému uživateli.';
    end if;

    perform 1
    from public.shopping_list_items sli
    where sli.shopping_list_id = new.shopping_list_id
    for update;

    select coalesce(jsonb_agg(item_signature order by item_signature::text), '[]'::jsonb)
    into v_current_items
    from (
      select jsonb_build_object(
        'product_id', case when sli.product_id is null then null else sli.product_id::text end,
        'custom_name', case
          when sli.product_id is null then lower(btrim(coalesce(sli.custom_name, '')))
          else null
        end,
        'quantity', sli.quantity,
        'unit', lower(coalesce(nullif(btrim(sli.unit), ''), 'ks'))
      ) as item_signature
      from public.shopping_list_items sli
      where sli.shopping_list_id = new.shopping_list_id
        and sli.is_completed = false
    ) current_rows;

    select coalesce(jsonb_agg(item_signature order by item_signature::text), '[]'::jsonb)
    into v_purchase_items
    from (
      select jsonb_build_object(
        'product_id', case
          when nullif(btrim(item.value->>'product_id'), '') is null then null
          else ((btrim(item.value->>'product_id'))::uuid)::text
        end,
        'custom_name', case
          when nullif(btrim(item.value->>'product_id'), '') is null then lower(btrim(coalesce(
            nullif(btrim(item.value->>'custom_name'), ''),
            nullif(btrim(item.value->>'name'), ''),
            ''
          )))
          else null
        end,
        'quantity', coalesce(nullif(item.value->>'quantity', '')::numeric, 1),
        'unit', lower(coalesce(nullif(btrim(item.value->>'unit'), ''), 'ks'))
      ) as item_signature
      from jsonb_array_elements(new.items) as item(value)
    ) purchase_rows;

    if v_current_items <> v_purchase_items then
      raise exception 'Nákupní seznam se mezitím změnil. Načti aktuální stav a dokončení zopakuj.';
    end if;

    v_atomic_completion := true;
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

  -- Keep cleanup inside the INSERT transaction. If the purchase INSERT fails at
  -- any later constraint/RLS step, PostgreSQL rolls these changes back as well.
  if v_atomic_completion then
    delete from public.shopping_list_items sli
    where sli.shopping_list_id = new.shopping_list_id;

    perform public.revoke_shopping_list_shares(new.shopping_list_id);
  end if;

  return new;
end;
$function$;
