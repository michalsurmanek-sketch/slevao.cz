create or replace function public.shopping_custom_name_key(p_name text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(public.unaccent(coalesce(p_name, ''))),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

revoke all on function public.shopping_custom_name_key(text) from public, anon;
grant execute on function public.shopping_custom_name_key(text) to authenticated;

alter table public.shopping_list_items
  add column if not exists custom_key text;

create or replace function public.set_shopping_list_item_custom_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is null then
    new.custom_key := public.shopping_custom_name_key(new.custom_name);
  else
    new.custom_key := null;
  end if;
  return new;
end;
$$;

revoke all on function public.set_shopping_list_item_custom_key() from public, anon, authenticated;

drop trigger if exists shopping_list_items_custom_key on public.shopping_list_items;
create trigger shopping_list_items_custom_key
before insert or update of custom_name, product_id
on public.shopping_list_items
for each row
execute function public.set_shopping_list_item_custom_key();

update public.shopping_list_items
set custom_key = case
  when product_id is null then public.shopping_custom_name_key(custom_name)
  else null
end;

do $$
begin
  if exists (
    select 1
    from public.shopping_list_items
    where product_id is null
      and custom_key is not null
    group by shopping_list_id, custom_key
    having count(*) > 1
  ) then
    raise exception 'Canonical shopping custom-name collision detected; migration aborted.';
  end if;
end;
$$;

drop index if exists public.shopping_list_items_one_custom_name_per_list_uidx;
create unique index if not exists shopping_list_items_one_custom_key_per_list_uidx
  on public.shopping_list_items (shopping_list_id, custom_key)
  where product_id is null and custom_key is not null;

alter table public.shopping_list_items
  drop constraint if exists shopping_list_items_custom_key_check;
alter table public.shopping_list_items
  add constraint shopping_list_items_custom_key_check
  check (
    (product_id is not null and custom_key is null)
    or
    (product_id is null and custom_key is not null)
  );

create or replace function public.add_own_shopping_list_custom_item(
  p_custom_name text,
  p_quantity numeric,
  p_unit text,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_list_id uuid;
  v_name text := nullif(left(trim(coalesce(p_custom_name, '')), 200), '');
  v_key text;
  v_quantity numeric := greatest(0.01, least(coalesce(p_quantity, 1), 999));
  v_unit text := left(coalesce(nullif(trim(p_unit), ''), 'ks'), 30);
  v_item public.shopping_list_items%rowtype;
  v_existing_mutation record;
  v_claimed_mutation boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Pro synchronizaci nákupního seznamu je nutné přihlášení.';
  end if;
  v_key := public.shopping_custom_name_key(v_name);
  if v_name is null or v_key is null then
    raise exception 'Položka musí mít název.';
  end if;
  if p_mutation_id is null then
    raise exception 'Chybí identifikátor změny.';
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

  perform 1
  from public.shopping_lists sl
  where sl.id = v_list_id
    and sl.user_id = v_user_id
    and sl.is_archived = false
  for update;

  if not found then
    raise exception 'Aktivní nákupní seznam už není dostupný.';
  end if;

  delete from public.shopping_list_add_mutations m
  where m.user_id = v_user_id
    and m.created_at < now() - interval '30 days';

  insert into public.shopping_list_add_mutations(
    user_id, mutation_id, shopping_list_id
  ) values (
    v_user_id, p_mutation_id, v_list_id
  )
  on conflict (user_id, mutation_id) do nothing;
  v_claimed_mutation := found;

  if not v_claimed_mutation then
    select m.shopping_list_id, m.item_id
    into v_existing_mutation
    from public.shopping_list_add_mutations m
    where m.user_id = v_user_id
      and m.mutation_id = p_mutation_id;

    if v_existing_mutation.item_id is not null then
      select i.*
      into v_item
      from public.shopping_list_items i
      where i.id = v_existing_mutation.item_id
        and i.shopping_list_id = v_existing_mutation.shopping_list_id;
    end if;

    return jsonb_build_object(
      'list_id', v_existing_mutation.shopping_list_id,
      'duplicate', true,
      'item', case when v_item.id is null then null else jsonb_build_object(
        'id', v_item.id,
        'product_id', v_item.product_id,
        'selected_offer_id', v_item.selected_offer_id,
        'custom_name', v_item.custom_name,
        'quantity', v_item.quantity,
        'unit', v_item.unit,
        'is_completed', v_item.is_completed,
        'created_at', v_item.created_at,
        'updated_at', v_item.updated_at
      ) end
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'slevao-owner-shopping-list-custom:' || v_list_id::text || ':' || v_key,
      0
    )
  );

  select i.*
  into v_item
  from public.shopping_list_items i
  where i.shopping_list_id = v_list_id
    and i.product_id is null
    and i.custom_key = v_key
  order by i.is_completed asc, i.created_at asc, i.id
  limit 1
  for update;

  if found then
    update public.shopping_list_items i
    set quantity = case
          when i.is_completed then v_quantity
          else least(999, i.quantity + v_quantity)
        end,
        unit = coalesce(nullif(v_unit, ''), i.unit, 'ks'),
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
      v_name,
      v_quantity,
      v_unit,
      false
    )
    returning * into v_item;
  end if;

  update public.shopping_list_add_mutations m
  set item_id = v_item.id
  where m.user_id = v_user_id
    and m.mutation_id = p_mutation_id;

  return jsonb_build_object(
    'list_id', v_list_id,
    'duplicate', false,
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

create or replace function public.increment_own_shopping_list_offer(p_offer_id uuid)
returns jsonb
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (timezone('Europe/Prague', now()))::date;
  v_list_id uuid;
  v_offer record;
  v_item public.shopping_list_items%rowtype;
  v_custom_name text;
  v_custom_key text;
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
    v_custom_key := public.shopping_custom_name_key(v_custom_name);
    if v_custom_name is null or v_custom_key is null then
      raise exception 'Nabídka nemá použitelný název.';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'slevao-shopping-list-custom:' || v_list_id::text || ':' || v_custom_key,
        0
      )
    );

    select i.*
    into v_item
    from public.shopping_list_items i
    where i.shopping_list_id = v_list_id
      and i.product_id is null
      and i.custom_key = v_custom_key
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

create or replace function public.mutate_shared_shopping_list(
  p_token text,
  p_action text,
  p_item_id uuid default null,
  p_product_id uuid default null,
  p_selected_offer_id uuid default null,
  p_custom_name text default null,
  p_quantity numeric default 1,
  p_unit text default 'ks',
  p_is_completed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_share record;
  v_item_id uuid;
  v_name text;
  v_key text;
  v_quantity numeric := greatest(0.01, least(coalesce(p_quantity, 1), 999));
  v_unit text := left(coalesce(nullif(trim(p_unit), ''), 'ks'), 30);
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;
  if v_share.permission <> 'edit' then
    raise exception 'Tento odkaz dovoluje pouze prohlížení seznamu.';
  end if;
  if p_action not in ('add', 'update', 'delete') then
    raise exception 'Neplatná operace se seznamem.';
  end if;

  if p_action = 'add' then
    v_name := nullif(left(trim(coalesce(p_custom_name, '')), 200), '');
    if p_product_id is null then
      v_key := public.shopping_custom_name_key(v_name);
    end if;
    if p_product_id is null and (v_name is null or v_key is null) then
      raise exception 'Položka musí mít produkt nebo název.';
    end if;

    if p_product_id is not null then
      if not exists (select 1 from public.products where id = p_product_id) then
        raise exception 'Produkt nebyl nalezen.';
      end if;

      insert into public.shopping_list_items(
        shopping_list_id, product_id, selected_offer_id, custom_name,
        quantity, unit, is_completed
      ) values (
        v_share.shopping_list_id,
        p_product_id,
        p_selected_offer_id,
        null,
        v_quantity,
        v_unit,
        coalesce(p_is_completed, false)
      )
      on conflict (shopping_list_id, product_id) where product_id is not null
      do update set
        selected_offer_id = coalesce(excluded.selected_offer_id, public.shopping_list_items.selected_offer_id),
        quantity = case
          when public.shopping_list_items.is_completed then excluded.quantity
          else least(999, public.shopping_list_items.quantity + excluded.quantity)
        end,
        unit = coalesce(nullif(excluded.unit, ''), public.shopping_list_items.unit, 'ks'),
        is_completed = false,
        updated_at = now()
      returning id into v_item_id;
    else
      perform pg_advisory_xact_lock(
        hashtextextended(
          'slevao-shared-shopping-list-custom:' || v_share.shopping_list_id::text || ':' || v_key,
          0
        )
      );

      select i.id into v_item_id
      from public.shopping_list_items i
      where i.shopping_list_id = v_share.shopping_list_id
        and i.product_id is null
        and i.custom_key = v_key
      order by i.is_completed asc, i.created_at asc, i.id
      limit 1
      for update;

      if v_item_id is null then
        insert into public.shopping_list_items(
          shopping_list_id, product_id, selected_offer_id, custom_name,
          quantity, unit, is_completed
        ) values (
          v_share.shopping_list_id,
          null,
          null,
          v_name,
          v_quantity,
          v_unit,
          coalesce(p_is_completed, false)
        )
        returning id into v_item_id;
      else
        update public.shopping_list_items i
        set quantity = case
              when i.is_completed then v_quantity
              else least(999, i.quantity + v_quantity)
            end,
            unit = coalesce(nullif(v_unit, ''), i.unit, 'ks'),
            is_completed = false,
            updated_at = now()
        where i.id = v_item_id
          and i.shopping_list_id = v_share.shopping_list_id;
      end if;
    end if;

  elsif p_action = 'update' then
    if p_item_id is null or not exists (
      select 1 from public.shopping_list_items
      where id = p_item_id and shopping_list_id = v_share.shopping_list_id
    ) then
      raise exception 'Položka nebyla nalezena.';
    end if;

    update public.shopping_list_items
    set selected_offer_id = p_selected_offer_id,
        quantity = v_quantity,
        unit = v_unit,
        is_completed = coalesce(p_is_completed, is_completed),
        updated_at = now()
    where id = p_item_id and shopping_list_id = v_share.shopping_list_id
    returning id into v_item_id;

  else
    if p_item_id is null then
      raise exception 'Chybí položka k odstranění.';
    end if;
    delete from public.shopping_list_items
    where id = p_item_id and shopping_list_id = v_share.shopping_list_id
    returning id into v_item_id;
    if v_item_id is null then
      raise exception 'Položka nebyla nalezena.';
    end if;
  end if;

  return public.get_shared_shopping_list(p_token);
end;
$$;

create or replace function public.repeat_shopping_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = 'public', 'pg_temp'
as $$
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
    v_custom_key := null;

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

  return jsonb_build_object(
    'list_id', v_list_id,
    'item_count', v_added
  );
end;
$$;
