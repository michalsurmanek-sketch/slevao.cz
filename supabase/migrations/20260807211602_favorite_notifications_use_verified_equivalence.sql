create or replace function public.notify_favorite_product_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product_name text;
  store_name text;
  notification_title text;
  notification_message text;
begin
  if new.product_id is null
     or new.status <> 'published'
     or new.valid_to < current_date
     or new.valid_from > current_date + 7 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not (
      (old.status is distinct from new.status and new.status = 'published')
      or (old.price is null and new.price is not null)
      or (old.price is not null and new.price < old.price)
      or old.product_id is distinct from new.product_id
      or (old.valid_to < current_date and new.valid_to >= current_date)
    ) then
      return new;
    end if;
  end if;

  select p.name, s.name
  into product_name, store_name
  from public.products p
  left join public.stores s on s.id = new.store_id
  where p.id = new.product_id;

  if tg_op = 'UPDATE' and old.price is not null and new.price < old.price then
    notification_title := 'Oblíbený produkt zlevnil';
  else
    notification_title := 'Nová akce na oblíbený produkt';
  end if;

  notification_message := format(
    '%s je nyní za %s Kč v %s. Akce platí do %s.',
    coalesce(product_name, new.title, 'Oblíbený produkt'),
    trim(to_char(new.price, 'FM999999990D00')),
    coalesce(store_name, 'obchodě'),
    to_char(new.valid_to, 'DD. MM. YYYY')
  );

  insert into public.notifications(
    user_id,
    type,
    title,
    message,
    offer_id,
    product_id,
    is_read,
    created_at
  )
  select
    pf.user_id,
    'favorite_offer',
    case
      when pf.product_id <> new.product_id then notification_title || ' · ověřeně stejný výrobek'
      else notification_title
    end,
    case
      when pf.product_id <> new.product_id then 'Ověřená equivalence: ' || notification_message
      else notification_message
    end,
    new.id,
    new.product_id,
    false,
    now()
  from public.product_favorites pf
  where public.slevao_products_equivalent(pf.product_id, new.product_id)
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.notify_favorite_product_offer() from public, anon, authenticated;
