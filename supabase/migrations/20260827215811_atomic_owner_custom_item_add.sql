create table if not exists public.shopping_list_add_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  item_id uuid references public.shopping_list_items(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

create index if not exists shopping_list_add_mutations_created_idx
  on public.shopping_list_add_mutations (user_id, created_at);

alter table public.shopping_list_add_mutations enable row level security;
revoke all on table public.shopping_list_add_mutations from public, anon, authenticated;

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
as $function$
declare
  v_user_id uuid := auth.uid();
  v_list_id uuid;
  v_name text := nullif(left(trim(coalesce(p_custom_name, '')), 200), '');
  v_quantity numeric := greatest(0.01, least(coalesce(p_quantity, 1), 999));
  v_unit text := left(coalesce(nullif(trim(p_unit), ''), 'ks'), 30);
  v_item public.shopping_list_items%rowtype;
  v_existing_mutation record;
  v_claimed_mutation boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Pro synchronizaci nákupního seznamu je nutné přihlášení.';
  end if;
  if v_name is null then
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

  -- Serialize all owner writes that can race with atomic purchase completion.
  perform 1
  from public.shopping_lists sl
  where sl.id = v_list_id
    and sl.user_id = v_user_id
    and sl.is_archived = false
  for update;

  if not found then
    raise exception 'Aktivní nákupní seznam už není dostupný.';
  end if;

  -- Keep enough history to make transport retries idempotent without allowing
  -- the internal operation log to grow forever.
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
      'slevao-owner-shopping-list-custom:' || v_list_id::text || ':' || lower(v_name),
      0
    )
  );

  select i.*
  into v_item
  from public.shopping_list_items i
  where i.shopping_list_id = v_list_id
    and i.product_id is null
    and lower(trim(coalesce(i.custom_name, ''))) = lower(v_name)
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
$function$;

revoke all on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) from public;
revoke all on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) from anon;
grant execute on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) to authenticated;
