create or replace function public.repeat_shopping_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_list_id uuid;
  v_items jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_custom_name text;
  v_quantity numeric;
  v_unit text;
  v_added integer := 0;
begin
  if v_user_id is null then
    raise exception 'Přihlášení je vyžadováno.';
  end if;

  select p.items
  into v_items
  from public.shopping_list_purchases p
  where p.id = p_purchase_id
    and p.user_id = v_user_id;

  if not found then
    raise exception 'Dokončený nákup neexistuje nebo nepatří přihlášenému uživateli.';
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Dokončený nákup neobsahuje žádné položky.';
  end if;

  select sl.id
  into v_list_id
  from public.shopping_lists sl
  where sl.user_id = v_user_id
    and sl.is_archived = false
  order by sl.created_at
  limit 1
  for update;

  if v_list_id is null then
    raise exception 'Aktivní nákupní seznam nebyl nalezen.';
  end if;

  for v_item in
    select item.value
    from jsonb_array_elements(v_items) as item(value)
  loop
    v_quantity := greatest(0.01, coalesce(nullif(v_item->>'quantity', '')::numeric, 1));
    v_unit := coalesce(nullif(btrim(v_item->>'unit'), ''), 'ks');
    v_product_id := null;
    v_custom_name := null;

    if nullif(btrim(v_item->>'product_id'), '') is not null then
      v_product_id := btrim(v_item->>'product_id')::uuid;

      update public.shopping_list_items
      set quantity = shopping_list_items.quantity + v_quantity,
          is_completed = false,
          updated_at = now()
      where shopping_list_id = v_list_id
        and product_id = v_product_id;

      if not found then
        begin
          insert into public.shopping_list_items (
            shopping_list_id,
            product_id,
            selected_offer_id,
            custom_name,
            quantity,
            unit,
            is_completed
          ) values (
            v_list_id,
            v_product_id,
            null,
            null,
            v_quantity,
            v_unit,
            false
          );
        exception when unique_violation then
          update public.shopping_list_items
          set quantity = shopping_list_items.quantity + v_quantity,
              is_completed = false,
              updated_at = now()
          where shopping_list_id = v_list_id
            and product_id = v_product_id;
        end;
      end if;

      v_added := v_added + 1;
      continue;
    end if;

    v_custom_name := coalesce(
      nullif(btrim(v_item->>'custom_name'), ''),
      nullif(btrim(v_item->>'name'), '')
    );
    if v_custom_name is null then
      continue;
    end if;

    update public.shopping_list_items
    set quantity = shopping_list_items.quantity + v_quantity,
        unit = coalesce(nullif(btrim(shopping_list_items.unit), ''), v_unit),
        is_completed = false,
        updated_at = now()
    where shopping_list_id = v_list_id
      and product_id is null
      and lower(btrim(custom_name)) = lower(btrim(v_custom_name));

    if not found then
      begin
        insert into public.shopping_list_items (
          shopping_list_id,
          product_id,
          selected_offer_id,
          custom_name,
          quantity,
          unit,
          is_completed
        ) values (
          v_list_id,
          null,
          null,
          v_custom_name,
          v_quantity,
          v_unit,
          false
        );
      exception when unique_violation then
        update public.shopping_list_items
        set quantity = shopping_list_items.quantity + v_quantity,
            unit = coalesce(nullif(btrim(shopping_list_items.unit), ''), v_unit),
            is_completed = false,
            updated_at = now()
        where shopping_list_id = v_list_id
          and product_id is null
          and lower(btrim(custom_name)) = lower(btrim(v_custom_name));
      end;
    end if;

    v_added := v_added + 1;
  end loop;

  if v_added = 0 then
    raise exception 'Dokončený nákup neobsahuje opakovatelné položky.';
  end if;

  update public.shopping_lists
  set updated_at = now()
  where id = v_list_id
    and user_id = v_user_id;

  return jsonb_build_object(
    'list_id', v_list_id,
    'item_count', v_added
  );
end;
$$;

revoke all on function public.repeat_shopping_purchase(uuid) from public;
revoke all on function public.repeat_shopping_purchase(uuid) from anon;
grant execute on function public.repeat_shopping_purchase(uuid) to authenticated;
