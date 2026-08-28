create or replace function public.validate_shopping_purchase_snapshot()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_purchase_date date := (timezone('Europe/Prague', new.completed_at))::date;
  v_purchase_window_end date := ((timezone('Europe/Prague', new.completed_at))::date + 7);
  v_planned numeric := 0;
  v_reference numeric := 0;
  v_store_count integer := 0;
  v_item_count integer := 0;
  v_atomic_completion boolean := false;
  v_completed_count integer := 0;
  v_completion_mode text := null;
  v_completed_items jsonb := '[]'::jsonb;
  v_uncompleted_items jsonb := '[]'::jsonb;
  v_purchase_items jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception 'Historie nákupu musí obsahovat pole položek.';
  end if;

  if tg_op = 'INSERT'
     and auth.uid() is not null
     and new.shopping_list_id is null then
    raise exception 'Před dokončením nákupu se nepodařilo určit aktivní nákupní seznam. Načti stránku znovu a zkus to znovu.';
  end if;

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

    select count(*) filter (where sli.is_completed)
    into v_completed_count
    from public.shopping_list_items sli
    where sli.shopping_list_id = new.shopping_list_id;

    select coalesce(jsonb_agg(item_signature order by item_signature::text), '[]'::jsonb)
    into v_completed_items
    from (
      select jsonb_build_object(
        'product_id', case when sli.product_id is null then null else sli.product_id::text end,
        'custom_key', case when sli.product_id is null then sli.custom_key else null end,
        'quantity', sli.quantity,
        'unit', lower(coalesce(nullif(btrim(sli.unit), ''), 'ks'))
      ) as item_signature
      from public.shopping_list_items sli
      where sli.shopping_list_id = new.shopping_list_id
        and sli.is_completed = true
    ) completed_rows;

    select coalesce(jsonb_agg(item_signature order by item_signature::text), '[]'::jsonb)
    into v_uncompleted_items
    from (
      select jsonb_build_object(
        'product_id', case when sli.product_id is null then null else sli.product_id::text end,
        'custom_key', case when sli.product_id is null then sli.custom_key else null end,
        'quantity', sli.quantity,
        'unit', lower(coalesce(nullif(btrim(sli.unit), ''), 'ks'))
      ) as item_signature
      from public.shopping_list_items sli
      where sli.shopping_list_id = new.shopping_list_id
        and sli.is_completed = false
    ) uncompleted_rows;

    select coalesce(jsonb_agg(item_signature order by item_signature::text), '[]'::jsonb)
    into v_purchase_items
    from (
      select jsonb_build_object(
        'product_id', case
          when nullif(btrim(item.value->>'product_id'), '') is null then null
          else ((btrim(item.value->>'product_id'))::uuid)::text
        end,
        'custom_key', case
          when nullif(btrim(item.value->>'product_id'), '') is null then public.shopping_custom_name_key(coalesce(
            nullif(btrim(item.value->>'custom_name'), ''),
            nullif(btrim(item.value->>'name'), '')
          ))
          else null
        end,
        'quantity', coalesce(nullif(item.value->>'quantity', '')::numeric, 1),
        'unit', lower(coalesce(nullif(btrim(item.value->>'unit'), ''), 'ks'))
      ) as item_signature
      from jsonb_array_elements(new.items) as item(value)
    ) purchase_rows;

    if v_completed_count > 0 and v_purchase_items = v_completed_items then
      v_completion_mode := 'completed';
    elsif v_purchase_items = v_uncompleted_items then
      v_completion_mode := case when v_completed_count > 0 then 'legacy_uncompleted' else 'full' end;
    else
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
          and o.valid_from <= v_purchase_window_end
          and o.valid_to >= v_purchase_date
          and (
            nullif(item.value->>'product_id', '') is null
            or o.product_id = (item.value->>'product_id')::uuid
          )
          and nullif(item.value->>'price', '') is not null
          and abs(o.price - (item.value->>'price')::numeric) <= 0.01
          and nullif(item.value->>'store_id', '') is not null
          and o.store_id = (item.value->>'store_id')::uuid
          and nullif(item.value->>'subtotal', '') is not null
          and abs(
            round(o.price * coalesce(nullif(item.value->>'quantity', '')::numeric, 1), 2)
            - (item.value->>'subtotal')::numeric
          ) <= 0.01
          and nullif(item.value->>'reference_subtotal', '') is not null
          and abs(
            round(
              greatest(coalesce(o.old_price, o.price), o.price)
              * coalesce(nullif(item.value->>'quantity', '')::numeric, 1),
              2
            )
            - (item.value->>'reference_subtotal')::numeric
          ) <= 0.01
      )
  ) then
    raise exception 'Historie obsahuje nabídku s neplatnou cenou, obchodem nebo mezisoučtem.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.items) as item(value)
    where nullif(item.value->>'offer_id', '') is null
      and (
        nullif(item.value->>'price', '') is not null
        or nullif(item.value->>'old_price', '') is not null
        or nullif(item.value->>'store_id', '') is not null
        or nullif(item.value->>'subtotal', '') is not null
        or nullif(item.value->>'reference_subtotal', '') is not null
      )
  ) then
    raise exception 'Neoceněná položka historie nesmí obsahovat cenu, obchod ani mezisoučet.';
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

  if v_atomic_completion then
    if v_completion_mode = 'completed' then
      delete from public.shopping_list_items sli
      where sli.shopping_list_id = new.shopping_list_id
        and sli.is_completed = true;
    else
      delete from public.shopping_list_items sli
      where sli.shopping_list_id = new.shopping_list_id;
    end if;

    if not exists (
      select 1
      from public.shopping_list_items sli
      where sli.shopping_list_id = new.shopping_list_id
    ) then
      perform public.revoke_shopping_list_shares(new.shopping_list_id);
    end if;
  end if;

  return new;
end;
$function$;
