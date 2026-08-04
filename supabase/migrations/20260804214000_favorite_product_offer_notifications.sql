alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array[
    'price_drop'::text,
    'price_alert'::text,
    'favorite_offer'::text,
    'offer_expiring'::text,
    'new_offer'::text,
    'system'::text
  ]));

create unique index if not exists notifications_favorite_offer_unique
on public.notifications(user_id, offer_id, type)
where type = 'favorite_offer' and offer_id is not null;

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
    notification_title,
    notification_message,
    new.id,
    new.product_id,
    false,
    now()
  from public.product_favorites pf
  where pf.product_id = new.product_id
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists offers_notify_favorite_products on public.offers;
create trigger offers_notify_favorite_products
after insert or update of product_id, price, status, valid_from, valid_to, store_id
on public.offers
for each row execute function public.notify_favorite_product_offer();