create or replace function public.guard_shopping_list_selected_offer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_today date := (timezone('Europe/Prague', now()))::date;
begin
  if new.selected_offer_id is null then
    return new;
  end if;

  if new.product_id is null or not exists (
    select 1
    from public.offers o
    where o.id = new.selected_offer_id
      and o.product_id = new.product_id
      and o.status = 'published'
      and o.is_verified = true
      and o.valid_to >= v_today
      and o.valid_from <= v_today + 7
  ) then
    new.selected_offer_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_shopping_list_selected_offer_trg on public.shopping_list_items;
create trigger guard_shopping_list_selected_offer_trg
before insert or update of product_id, selected_offer_id
on public.shopping_list_items
for each row execute function public.guard_shopping_list_selected_offer();

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
    set selected_offer_id = p_selected_offer_id,
        quantity = greatest(0.01, least(coalesce(p_quantity, quantity), 999)),
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

create or replace function private.clear_stale_shopping_list_selected_offers()
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_today date := (timezone('Europe/Prague', now()))::date;
  v_changed integer := 0;
begin
  update public.shopping_list_items i
  set selected_offer_id = null,
      updated_at = now()
  where i.selected_offer_id is not null
    and not exists (
      select 1
      from public.offers o
      where o.id = i.selected_offer_id
        and o.product_id = i.product_id
        and o.status = 'published'
        and o.is_verified = true
        and o.valid_to >= v_today
        and o.valid_from <= v_today + 7
    );
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function private.clear_stale_shopping_list_selected_offers() from public, anon, authenticated;
grant execute on function private.clear_stale_shopping_list_selected_offers() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-clear-stale-list-offers' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-clear-stale-list-offers',
    '23 * * * *',
    'select private.clear_stale_shopping_list_selected_offers();'
  );
end $$;
