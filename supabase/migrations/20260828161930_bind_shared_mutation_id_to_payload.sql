alter table private.shopping_share_mutations
  add column request_hash text not null
  check (request_hash ~ '^[0-9a-f]{64}$');

create or replace function public.mutate_shared_shopping_list(
  p_token text,
  p_action text,
  p_mutation_id uuid,
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
set search_path to 'public'
as $function$
declare
  v_share record;
  v_item_id uuid;
  v_name text;
  v_key text;
  v_quantity numeric := greatest(0.01, least(coalesce(p_quantity, 1), 999));
  v_unit text := left(coalesce(nullif(trim(p_unit), ''), 'ks'), 30);
  v_claimed_mutation uuid;
  v_existing_action text;
  v_existing_request_hash text;
  v_request_hash text;
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
    v_request_hash := encode(extensions.digest(jsonb_build_object(
      'action', 'add',
      'product_id', p_product_id,
      'selected_offer_id', p_selected_offer_id,
      'custom_name', v_name,
      'quantity', v_quantity,
      'unit', v_unit,
      'is_completed', coalesce(p_is_completed, false)
    )::text, 'sha256'), 'hex');
  elsif p_action = 'update' then
    v_request_hash := encode(extensions.digest(jsonb_build_object(
      'action', 'update',
      'item_id', p_item_id,
      'selected_offer_id', p_selected_offer_id,
      'quantity', v_quantity,
      'unit', v_unit,
      'is_completed', p_is_completed
    )::text, 'sha256'), 'hex');
  else
    v_request_hash := encode(extensions.digest(jsonb_build_object(
      'action', 'delete',
      'item_id', p_item_id
    )::text, 'sha256'), 'hex');
  end if;

  if p_mutation_id is not null then
    insert into private.shopping_share_mutations(
      share_id, mutation_id, action, request_hash, shopping_list_id
    ) values (
      v_share.share_id, p_mutation_id, p_action, v_request_hash, v_share.shopping_list_id
    )
    on conflict (share_id, mutation_id) do nothing
    returning mutation_id into v_claimed_mutation;

    if v_claimed_mutation is null then
      select m.action, m.request_hash
      into v_existing_action, v_existing_request_hash
      from private.shopping_share_mutations m
      where m.share_id = v_share.share_id
        and m.mutation_id = p_mutation_id;

      if v_existing_action is distinct from p_action
         or v_existing_request_hash is distinct from v_request_hash then
        raise exception 'Mutation ID už bylo použito s jinými daty.';
      end if;

      return public.get_shared_shopping_list(p_token);
    end if;
  end if;

  if p_action = 'add' then
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

  if p_mutation_id is not null then
    update private.shopping_share_mutations
    set item_id = v_item_id
    where share_id = v_share.share_id
      and mutation_id = p_mutation_id;
  end if;

  return public.get_shared_shopping_list(p_token);
end;
$function$;

revoke all on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,uuid,text,numeric,text,boolean) from public;
grant execute on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,uuid,text,numeric,text,boolean) to anon, authenticated, service_role;
