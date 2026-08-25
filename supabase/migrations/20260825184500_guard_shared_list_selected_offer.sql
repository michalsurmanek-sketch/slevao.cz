-- Prevent a shared-list edit token from attaching an unrelated offer to a product.
-- Invalid or unrelated selected_offer_id values are normalized to NULL.

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
set search_path = public
as $$
declare
  v_share record;
  v_item_id uuid;
  v_name text;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;
  if v_share.permission <> 'edit' then
    raise exception 'Tento odkaz dovoluje pouze prohlížení seznamu.';
  end if;
  if p_action not in ('add','update','delete') then
    raise exception 'Neplatná operace se seznamem.';
  end if;

  if p_action = 'add' then
    v_name := nullif(left(trim(coalesce(p_custom_name,'')), 200), '');
    if p_product_id is null and v_name is null then
      raise exception 'Položka musí mít produkt nebo název.';
    end if;
    if p_product_id is not null and not exists (
      select 1 from public.products where id = p_product_id
    ) then
      raise exception 'Produkt nebyl nalezen.';
    end if;

    if p_selected_offer_id is not null and (
      p_product_id is null or not exists (
        select 1
        from public.offers o
        where o.id = p_selected_offer_id
          and o.product_id = p_product_id
      )
    ) then
      p_selected_offer_id := null;
    end if;

    insert into public.shopping_list_items(
      shopping_list_id, product_id, selected_offer_id, custom_name,
      quantity, unit, is_completed
    ) values (
      v_share.shopping_list_id,
      p_product_id,
      p_selected_offer_id,
      case when p_product_id is null then v_name else null end,
      greatest(0.01, least(coalesce(p_quantity,1), 999)),
      left(coalesce(nullif(trim(p_unit),''),'ks'), 30),
      coalesce(p_is_completed,false)
    ) returning id into v_item_id;

  elsif p_action = 'update' then
    if p_item_id is null or not exists (
      select 1 from public.shopping_list_items
      where id = p_item_id and shopping_list_id = v_share.shopping_list_id
    ) then
      raise exception 'Položka nebyla nalezena.';
    end if;

    update public.shopping_list_items
    set quantity = greatest(0.01, least(coalesce(p_quantity, quantity), 999)),
        unit = left(coalesce(nullif(trim(p_unit),''), unit, 'ks'), 30),
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

revoke all on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean) from public;
grant execute on function public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean) to anon, authenticated;
