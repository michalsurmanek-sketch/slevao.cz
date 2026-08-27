create unique index if not exists shopping_lists_one_active_per_user_uidx
on public.shopping_lists(user_id)
where is_archived = false;

create unique index if not exists shopping_list_items_one_product_per_list_uidx
on public.shopping_list_items(shopping_list_id, product_id)
where product_id is not null;

create or replace function public.increment_own_shopping_list_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (timezone('Europe/Prague', now()))::date;
  v_list_id uuid;
  v_offer record;
  v_item public.shopping_list_items%rowtype;
  v_custom_name text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Pro synchronizaci nákupního seznamu je nutné přihlášení.';
  end if;

  select o.id, o.product_id, o.title
  into v_offer
  from public.offers o
  where o.id = p_offer_id
    and o.status = 'published'
    and o.is_verified = true
    and o.valid_to >= v_today
    and o.valid_from <= v_today + 7;

  if not found then
    raise exception using errcode = 'P0002', message = 'Nabídka už není dostupná.';
  end if;

  insert into public.shopping_lists(user_id, name, is_archived)
  values (v_user_id, 'Můj nákup', false)
  on conflict (user_id) where is_archived = false do nothing
  returning id into v_list_id;

  if v_list_id is null then
    select sl.id
    into v_list_id
    from public.shopping_lists sl
    where sl.user_id = v_user_id
      and sl.is_archived = false
    order by sl.created_at, sl.id
    limit 1;
  end if;

  if v_list_id is null then
    raise exception 'Aktivní nákupní seznam se nepodařilo vytvořit.';
  end if;

  if v_offer.product_id is not null then
    insert into public.shopping_list_items(
      shopping_list_id,
      product_id,
      selected_offer_id,
      custom_name,
      quantity,
      unit,
      is_completed
    ) values (
      v_list_id,
      v_offer.product_id,
      v_offer.id,
      null,
      1,
      'ks',
      false
    )
    on conflict (shopping_list_id, product_id) where product_id is not null
    do update set
      selected_offer_id = excluded.selected_offer_id,
      quantity = case
        when public.shopping_list_items.is_completed then 1
        else public.shopping_list_items.quantity + 1
      end,
      unit = coalesce(public.shopping_list_items.unit, excluded.unit, 'ks'),
      is_completed = false,
      updated_at = now()
    returning * into v_item;
  else
    v_custom_name := nullif(left(trim(coalesce(v_offer.title, '')), 200), '');
    if v_custom_name is null then
      raise exception 'Nabídka nemá použitelný název.';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'slevao-shopping-list-custom:' || v_list_id::text || ':' || lower(v_custom_name),
        0
      )
    );

    select i.*
    into v_item
    from public.shopping_list_items i
    where i.shopping_list_id = v_list_id
      and i.product_id is null
      and lower(trim(coalesce(i.custom_name, ''))) = lower(v_custom_name)
    order by i.is_completed asc, i.created_at asc, i.id
    limit 1
    for update;

    if found then
      update public.shopping_list_items i
      set quantity = case when i.is_completed then 1 else i.quantity + 1 end,
          unit = coalesce(i.unit, 'ks'),
          is_completed = false,
          updated_at = now()
      where i.id = v_item.id
        and i.shopping_list_id = v_list_id
      returning i.* into v_item;
    else
      insert into public.shopping_list_items(
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
        1,
        'ks',
        false
      )
      returning * into v_item;
    end if;
  end if;

  return jsonb_build_object(
    'list_id', v_list_id,
    'item', jsonb_build_object(
      'id', v_item.id,
      'product_id', v_item.product_id,
      'selected_offer_id', v_item.selected_offer_id,
      'custom_name', v_item.custom_name,
      'quantity', v_item.quantity,
      'unit', v_item.unit,
      'is_completed', v_item.is_completed,
      'created_at', v_item.created_at,
      'updated_at', v_item.updated_at
    )
  );
end;
$$;

revoke all on function public.increment_own_shopping_list_offer(uuid) from public, anon;
grant execute on function public.increment_own_shopping_list_offer(uuid) to authenticated;

comment on function public.increment_own_shopping_list_offer(uuid) is
'Atomically finds or creates the authenticated user active shopping list and increments/re-activates one current verified offer item.';
