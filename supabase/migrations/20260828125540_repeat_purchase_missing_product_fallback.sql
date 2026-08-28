create or replace function public.repeat_shopping_purchase(p_purchase_id uuid, p_mutation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_list_id uuid;
  v_items jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_custom_name text;
  v_custom_key text;
  v_quantity numeric;
  v_unit text;
  v_added integer := 0;
  v_claimed boolean := false;
  v_existing public.shopping_purchase_repeat_mutations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Přihlášení je vyžadováno.';
  end if;
  if p_purchase_id is null then
    raise exception 'Chybí dokončený nákup.';
  end if;
  if p_mutation_id is null then
    raise exception 'Chybí identifikátor změny.';
  end if;

  select m.*
  into v_existing
  from public.shopping_purchase_repeat_mutations m
  where m.user_id = v_user_id
    and m.mutation_id = p_mutation_id;

  if found then
    if v_existing.purchase_id <> p_purchase_id then
      raise exception 'Identifikátor změny už byl použit pro jiný nákup.';
    end if;
    return jsonb_build_object(
      'list_id', v_existing.shopping_list_id,
      'item_count', coalesce(v_existing.item_count, 0),
      'duplicate', true
    );
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
  order by sl.created_at, sl.id
  limit 1
  for update;

  if v_list_id is null then
    raise exception 'Aktivní nákupní seznam nebyl nalezen.';
  end if;

  delete from public.shopping_purchase_repeat_mutations m
  where m.user_id = v_user_id
    and m.created_at < now() - interval '30 days';

  insert into public.shopping_purchase_repeat_mutations(
    user_id, mutation_id, purchase_id, shopping_list_id
  ) values (
    v_user_id, p_mutation_id, p_purchase_id, v_list_id
  )
  on conflict (user_id, mutation_id) do nothing;
  v_claimed := found;

  if not v_claimed then
    select m.*
    into v_existing
    from public.shopping_purchase_repeat_mutations m
    where m.user_id = v_user_id
      and m.mutation_id = p_mutation_id;

    if not found then
      raise exception 'Identifikátor změny se nepodařilo ověřit.';
    end if;
    if v_existing.purchase_id <> p_purchase_id then
      raise exception 'Identifikátor změny už byl použit pro jiný nákup.';
    end if;
    return jsonb_build_object(
      'list_id', v_existing.shopping_list_id,
      'item_count', coalesce(v_existing.item_count, 0),
      'duplicate', true
    );
  end if;

  for v_item in
    select item.value
    from jsonb_array_elements(v_items) as item(value)
  loop
    v_quantity := greatest(0.01, coalesce(nullif(v_item->>'quantity', '')::numeric, 1));
    v_unit := coalesce(nullif(btrim(v_item->>'unit'), ''), 'ks');
    v_product_id := null;
    v_custom_name := null;
    v_custom_key := null;

    if nullif(btrim(v_item->>'product_id'), '') is not null then
      v_product_id := btrim(v_item->>'product_id')::uuid;

      perform 1
      from public.products p
      where p.id = v_product_id
      for key share;

      if found then
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

      -- Historical snapshots deliberately keep product_id without a foreign key.
      -- If that catalog row was removed later, preserve the shopping intent by
      -- restoring the historical label as a custom item instead of failing the
      -- whole repeat operation on shopping_list_items_product_id_fkey.
      v_product_id := null;
      v_custom_name := coalesce(
        nullif(btrim(v_item->>'custom_name'), ''),
        nullif(btrim(v_item->>'name'), '')
      );
    else
      v_custom_name := coalesce(
        nullif(btrim(v_item->>'custom_name'), ''),
        nullif(btrim(v_item->>'name'), '')
      );
    end if;

    v_custom_key := public.shopping_custom_name_key(v_custom_name);
    if v_custom_name is null or v_custom_key is null then
      continue;
    end if;

    update public.shopping_list_items
    set quantity = shopping_list_items.quantity + v_quantity,
        unit = coalesce(nullif(btrim(shopping_list_items.unit), ''), v_unit),
        is_completed = false,
        updated_at = now()
    where shopping_list_id = v_list_id
      and product_id is null
      and custom_key = v_custom_key;

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
          and custom_key = v_custom_key;
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

  update public.shopping_purchase_repeat_mutations m
  set item_count = v_added
  where m.user_id = v_user_id
    and m.mutation_id = p_mutation_id;

  return jsonb_build_object(
    'list_id', v_list_id,
    'item_count', v_added,
    'duplicate', false
  );
end;
$function$;
