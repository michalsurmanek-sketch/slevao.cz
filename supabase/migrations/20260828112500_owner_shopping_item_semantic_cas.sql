create or replace function public.mutate_owner_shopping_list_item_if_current(
  p_item_id uuid,
  p_shopping_list_id uuid,
  p_action text,
  p_expected_quantity numeric,
  p_expected_unit text,
  p_expected_is_completed boolean,
  p_expected_selected_offer_id uuid,
  p_next_quantity numeric default null,
  p_next_unit text default null,
  p_next_is_completed boolean default null,
  p_next_selected_offer_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.shopping_list_items%rowtype;
  v_updated public.shopping_list_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select *
    into v_current
    from public.shopping_list_items
   where id = p_item_id
     and shopping_list_id = p_shopping_list_id;

  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  if v_current.quantity is distinct from p_expected_quantity
     or v_current.unit is distinct from p_expected_unit
     or v_current.is_completed is distinct from p_expected_is_completed
     or v_current.selected_offer_id is distinct from p_expected_selected_offer_id then
    return jsonb_build_object(
      'status', 'conflict',
      'current', jsonb_build_object(
        'id', v_current.id,
        'quantity', v_current.quantity,
        'unit', v_current.unit,
        'is_completed', v_current.is_completed,
        'selected_offer_id', v_current.selected_offer_id,
        'updated_at', v_current.updated_at
      )
    );
  end if;

  if p_action = 'delete' then
    delete from public.shopping_list_items
     where id = p_item_id
       and shopping_list_id = p_shopping_list_id;
    return jsonb_build_object('status', 'deleted');
  end if;

  if p_action <> 'update' then
    raise exception using errcode = '22023', message = 'Unsupported shopping-list mutation action';
  end if;

  update public.shopping_list_items
     set quantity = coalesce(p_next_quantity, v_current.quantity),
         unit = p_next_unit,
         is_completed = coalesce(p_next_is_completed, v_current.is_completed),
         selected_offer_id = p_next_selected_offer_id
   where id = p_item_id
     and shopping_list_id = p_shopping_list_id
   returning * into v_updated;

  return jsonb_build_object(
    'status', 'updated',
    'current', jsonb_build_object(
      'id', v_updated.id,
      'quantity', v_updated.quantity,
      'unit', v_updated.unit,
      'is_completed', v_updated.is_completed,
      'selected_offer_id', v_updated.selected_offer_id,
      'updated_at', v_updated.updated_at
    )
  );
end;
$$;

revoke all on function public.mutate_owner_shopping_list_item_if_current(uuid, uuid, text, numeric, text, boolean, uuid, numeric, text, boolean, uuid) from public, anon;
grant execute on function public.mutate_owner_shopping_list_item_if_current(uuid, uuid, text, numeric, text, boolean, uuid, numeric, text, boolean, uuid) to authenticated;

create or replace function public.delete_owner_shopping_list_items_if_current(
  p_shopping_list_id uuid,
  p_expected jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mismatch integer := 0;
  v_deleted integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_expected is null or jsonb_typeof(p_expected) <> 'array' then
    raise exception using errcode = '22023', message = 'Expected shopping-list rows must be a JSON array';
  end if;

  if jsonb_array_length(p_expected) = 0 then
    return jsonb_build_object('status', 'deleted', 'deleted_count', 0);
  end if;

  with expected as (
    select
      (item->>'id')::uuid as id,
      (item->>'quantity')::numeric as quantity,
      item->>'unit' as unit,
      (item->>'is_completed')::boolean as is_completed,
      case
        when nullif(item->>'selected_offer_id', '') is null then null::uuid
        else (item->>'selected_offer_id')::uuid
      end as selected_offer_id
    from jsonb_array_elements(p_expected) as item
  )
  select count(*)::integer
    into v_mismatch
    from expected e
    left join public.shopping_list_items i
      on i.id = e.id
     and i.shopping_list_id = p_shopping_list_id
   where i.id is null
      or i.quantity is distinct from e.quantity
      or i.unit is distinct from e.unit
      or i.is_completed is distinct from e.is_completed
      or i.selected_offer_id is distinct from e.selected_offer_id;

  if v_mismatch > 0 then
    return jsonb_build_object('status', 'conflict', 'conflict_count', v_mismatch);
  end if;

  with expected as (
    select (item->>'id')::uuid as id
    from jsonb_array_elements(p_expected) as item
  )
  delete from public.shopping_list_items i
  using expected e
   where i.id = e.id
     and i.shopping_list_id = p_shopping_list_id;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('status', 'deleted', 'deleted_count', v_deleted);
end;
$$;

revoke all on function public.delete_owner_shopping_list_items_if_current(uuid, jsonb) from public, anon;
grant execute on function public.delete_owner_shopping_list_items_if_current(uuid, jsonb) to authenticated;
