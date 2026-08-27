-- Do not describe upcoming prices as if they were already valid today.

create or replace function public.slevao_insert_price_notifications(p_offer_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_offer record;
  v_alert record;
  v_notification_id uuid;
  v_inserted integer := 0;
  v_today date := (timezone('Europe/Prague', now()))::date;
begin
  select
    o.id, o.product_id, o.store_id, o.price, o.valid_from, o.valid_to,
    p.name as product_name,
    s.name as store_name
  into v_offer
  from public.offers o
  join public.products p on p.id = o.product_id
  join public.stores s on s.id = o.store_id
  where o.id = p_offer_id
    and o.product_id is not null
    and o.status = 'published'
    and o.is_verified = true
    and o.valid_to >= v_today
    and o.valid_from <= v_today + 7;

  if not found then
    return 0;
  end if;

  for v_alert in
    select pa.id, pa.user_id, pa.target_price, pa.product_id
    from public.price_alerts pa
    where pa.is_active = true
      and public.slevao_products_curated_equivalent(pa.product_id, v_offer.product_id)
      and (pa.store_id is null or pa.store_id = v_offer.store_id)
      and v_offer.price <= pa.target_price
  loop
    v_notification_id := null;

    insert into public.notifications(
      user_id, type, title, message, offer_id, product_id,
      price_alert_id, price_alert_event_price, is_read, created_at
    ) values (
      v_alert.user_id,
      'price_drop',
      case
        when v_offer.valid_from > v_today then
          'Cena bude od ' || to_char(v_offer.valid_from, 'DD. MM.') || ' za ' || trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč'
        else
          'Cena klesla na ' || trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč'
      end,
      case
        when v_offer.valid_from > v_today then
          (case when v_alert.product_id is distinct from v_offer.product_id then 'Ověřeně stejný výrobek: ' else '' end) ||
          'Od ' || to_char(v_offer.valid_from, 'DD. MM. YYYY') || ' bude ' || v_offer.product_name || ' v ' || v_offer.store_name || ' za ' ||
          trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč. Tvůj limit je ' ||
          trim(to_char(v_alert.target_price, 'FM999999990D00')) || ' Kč.'
        else
          (case when v_alert.product_id is distinct from v_offer.product_id then 'Ověřeně stejný výrobek: ' else '' end) ||
          v_offer.product_name || ' je v ' || v_offer.store_name || ' za ' ||
          trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč. Tvůj limit je ' ||
          trim(to_char(v_alert.target_price, 'FM999999990D00')) || ' Kč.'
      end,
      v_offer.id,
      v_offer.product_id,
      v_alert.id,
      v_offer.price,
      false,
      now()
    )
    on conflict do nothing
    returning id into v_notification_id;

    if v_notification_id is not null then
      update public.price_alerts
      set last_triggered_at = now(), updated_at = now()
      where id = v_alert.id;
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$function$;

create or replace function public.notify_favorite_product_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  product_name text;
  store_name text;
  notification_title text;
  notification_message text;
  v_today date := (timezone('Europe/Prague', now()))::date;
begin
  if new.product_id is null
     or new.status <> 'published'
     or coalesce(new.is_verified, false) is not true
     or new.valid_to < v_today
     or new.valid_from > v_today + 7 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not (
      (old.status is distinct from new.status and new.status = 'published')
      or (coalesce(old.is_verified, false) is false and new.is_verified is true)
      or (old.price is null and new.price is not null)
      or (old.price is not null and new.price < old.price)
      or old.product_id is distinct from new.product_id
      or old.store_id is distinct from new.store_id
      or (old.valid_to < v_today and new.valid_to >= v_today)
      or (old.valid_from > v_today + 7 and new.valid_from <= v_today + 7)
    ) then
      return new;
    end if;
  end if;

  select p.name, s.name
  into product_name, store_name
  from public.products p
  left join public.stores s on s.id = new.store_id
  where p.id = new.product_id;

  if new.valid_from > v_today then
    notification_title := 'Blíží se akce na oblíbený produkt';
    notification_message := format(
      'Od %s bude %s za %s Kč v %s. Akce platí do %s.',
      to_char(new.valid_from, 'DD. MM. YYYY'),
      coalesce(product_name, new.title, 'Oblíbený produkt'),
      trim(to_char(new.price, 'FM999999990D00')),
      coalesce(store_name, 'obchodě'),
      to_char(new.valid_to, 'DD. MM. YYYY')
    );
  else
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
  end if;

  insert into public.notifications(
    user_id, type, title, message, offer_id, product_id,
    favorite_event_price, is_read, created_at
  )
  select
    pf.user_id,
    'favorite_offer',
    notification_title,
    notification_message,
    new.id,
    new.product_id,
    new.price,
    false,
    now()
  from public.product_favorites pf
  where pf.product_id = new.product_id
  on conflict do nothing;

  return new;
end;
$function$;
