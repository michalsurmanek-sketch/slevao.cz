alter table public.shopping_list_items
  add column if not exists is_recipe boolean not null default false,
  add column if not exists recipe_ids text[] not null default '{}'::text[];

create or replace function public.sync_own_shopping_list_recipe_item(
  p_source_item_id uuid,
  p_custom_name text,
  p_recipe_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_list_id uuid;
  v_name text := nullif(left(trim(coalesce(p_custom_name, '')), 200), '');
  v_key text;
  v_recipe_ids text[] := '{}'::text[];
  v_merged_recipe_ids text[] := '{}'::text[];
  v_source public.shopping_list_items%rowtype;
  v_target public.shopping_list_items%rowtype;
  v_item public.shopping_list_items%rowtype;
  v_target_safe boolean := false;
  v_source_found boolean := false;
  v_target_found boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Pro synchronizaci receptu je nutné přihlášení.';
  end if;

  if v_name is null then
    raise exception using errcode = '22023', message = 'Receptová položka musí mít název.';
  end if;

  v_key := public.shopping_custom_name_key(v_name);
  if v_key is null then
    raise exception using errcode = '22023', message = 'Receptová položka musí mít platný název.';
  end if;

  select coalesce(array_agg(recipe_id order by recipe_id), '{}'::text[])
    into v_recipe_ids
    from (
      select distinct left(btrim(value), 64) as recipe_id
      from unnest(coalesce(p_recipe_ids, '{}'::text[])) as value
      where nullif(btrim(value), '') is not null
      order by 1
      limit 32
    ) ids;

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

  perform pg_advisory_xact_lock(
    hashtextextended(
      'slevao-owner-shopping-list-custom:' || v_list_id::text || ':' || v_key,
      0
    )
  );

  if p_source_item_id is not null then
    select i.*
      into v_source
      from public.shopping_list_items i
     where i.id = p_source_item_id
       and i.shopping_list_id = v_list_id
       and i.product_id is null
     for update;
    v_source_found := found;
  end if;

  if v_source_found and v_source.custom_key = v_key then
    select coalesce(array_agg(recipe_id order by recipe_id), '{}'::text[])
      into v_merged_recipe_ids
      from (
        select distinct btrim(value) as recipe_id
        from unnest(coalesce(v_source.recipe_ids, '{}'::text[]) || v_recipe_ids) as value
        where nullif(btrim(value), '') is not null
      ) ids;

    update public.shopping_list_items i
       set custom_name = v_name,
           quantity = 1,
           unit = 'ks',
           is_completed = false,
           is_recipe = true,
           recipe_ids = v_merged_recipe_ids,
           updated_at = now()
     where i.id = v_source.id
       and i.shopping_list_id = v_list_id
     returning i.* into v_item;

    return jsonb_build_object(
      'status', 'existing',
      'list_id', v_list_id,
      'item', to_jsonb(v_item)
    );
  end if;

  select i.*
    into v_target
    from public.shopping_list_items i
   where i.shopping_list_id = v_list_id
     and i.product_id is null
     and i.custom_key = v_key
     and (not v_source_found or i.id <> v_source.id)
   order by i.is_completed asc, i.created_at asc, i.id
   limit 1
   for update;
  v_target_found := found;

  if v_target_found then
    v_target_safe := v_target.is_recipe
      or (
        v_target.quantity = 1
        and lower(coalesce(nullif(trim(v_target.unit), ''), 'ks')) = 'ks'
        and v_target.custom_name ~* '\([0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků)\)[[:space:]]*$'
      );

    if not v_target_safe then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'target_not_recipe_safe',
        'list_id', v_list_id,
        'item', to_jsonb(v_target)
      );
    end if;

    select coalesce(array_agg(recipe_id order by recipe_id), '{}'::text[])
      into v_merged_recipe_ids
      from (
        select distinct btrim(value) as recipe_id
        from unnest(
          coalesce(v_target.recipe_ids, '{}'::text[])
          || case when v_source_found then coalesce(v_source.recipe_ids, '{}'::text[]) else '{}'::text[] end
          || v_recipe_ids
        ) as value
        where nullif(btrim(value), '') is not null
      ) ids;

    update public.shopping_list_items i
       set custom_name = v_name,
           quantity = 1,
           unit = 'ks',
           is_completed = false,
           is_recipe = true,
           recipe_ids = v_merged_recipe_ids,
           updated_at = now()
     where i.id = v_target.id
       and i.shopping_list_id = v_list_id
     returning i.* into v_item;

    if v_source_found and v_source.id <> v_item.id then
      delete from public.shopping_list_items i
       where i.id = v_source.id
         and i.shopping_list_id = v_list_id
         and i.product_id is null;
    end if;

    return jsonb_build_object(
      'status', case when v_source_found then 'deduped' else 'existing' end,
      'list_id', v_list_id,
      'source_deleted', v_source_found,
      'item', to_jsonb(v_item)
    );
  end if;

  if v_source_found then
    update public.shopping_list_items i
       set custom_name = v_name,
           quantity = 1,
           unit = 'ks',
           is_completed = false,
           is_recipe = true,
           recipe_ids = v_recipe_ids,
           updated_at = now()
     where i.id = v_source.id
       and i.shopping_list_id = v_list_id
     returning i.* into v_item;

    return jsonb_build_object(
      'status', 'updated',
      'list_id', v_list_id,
      'item', to_jsonb(v_item)
    );
  end if;

  insert into public.shopping_list_items(
    shopping_list_id,
    product_id,
    selected_offer_id,
    custom_name,
    quantity,
    unit,
    is_completed,
    is_recipe,
    recipe_ids
  ) values (
    v_list_id,
    null,
    null,
    v_name,
    1,
    'ks',
    false,
    true,
    v_recipe_ids
  )
  returning * into v_item;

  return jsonb_build_object(
    'status', 'inserted',
    'list_id', v_list_id,
    'item', to_jsonb(v_item)
  );
end;
$$;

revoke all on function public.sync_own_shopping_list_recipe_item(uuid, text, text[]) from public, anon;
grant execute on function public.sync_own_shopping_list_recipe_item(uuid, text, text[]) to authenticated;
