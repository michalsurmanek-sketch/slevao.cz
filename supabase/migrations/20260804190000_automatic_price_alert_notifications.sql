alter table public.notifications
  add column if not exists price_alert_id uuid references public.price_alerts(id) on delete cascade;

create unique index if not exists notifications_price_alert_offer_unique
  on public.notifications(price_alert_id, offer_id, type)
  where price_alert_id is not null and offer_id is not null;

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, is_read, created_at desc);

create or replace function public.slevao_insert_price_notifications(p_offer_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer record;
  v_alert record;
  v_notification_id uuid;
  v_inserted integer := 0;
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
    and o.valid_to >= current_date
    and o.valid_from <= current_date + 7;

  if not found then
    return 0;
  end if;

  for v_alert in
    select pa.id, pa.user_id, pa.target_price
    from public.price_alerts pa
    where pa.is_active = true
      and pa.product_id = v_offer.product_id
      and (pa.store_id is null or pa.store_id = v_offer.store_id)
      and v_offer.price <= pa.target_price
  loop
    v_notification_id := null;

    insert into public.notifications(
      user_id, type, title, message, offer_id, product_id,
      price_alert_id, is_read, created_at
    ) values (
      v_alert.user_id,
      'price_alert',
      'Cena klesla na ' || trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč',
      v_offer.product_name || ' je v ' || v_offer.store_name || ' za ' ||
        trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč. Tvůj limit je ' ||
        trim(to_char(v_alert.target_price, 'FM999999990D00')) || ' Kč.',
      v_offer.id,
      v_offer.product_id,
      v_alert.id,
      false,
      now()
    )
    on conflict (price_alert_id, offer_id, type)
      where price_alert_id is not null and offer_id is not null
    do nothing
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
$$;

create or replace function public.slevao_offer_price_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.slevao_insert_price_notifications(new.id);
  return new;
end;
$$;

create or replace function public.slevao_price_alert_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer_id uuid;
begin
  if new.is_active = true and new.product_id is not null then
    select o.id into v_offer_id
    from public.offers o
    where o.product_id = new.product_id
      and o.status = 'published'
      and o.valid_to >= current_date
      and o.valid_from <= current_date + 7
      and o.price <= new.target_price
      and (new.store_id is null or o.store_id = new.store_id)
    order by
      case when o.valid_from <= current_date then 0 else 1 end,
      o.price asc,
      o.valid_from asc
    limit 1;

    if v_offer_id is not null then
      perform public.slevao_insert_price_notifications(v_offer_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists offers_price_alert_notifications on public.offers;
create trigger offers_price_alert_notifications
after insert or update of product_id, store_id, price, status, valid_from, valid_to
on public.offers
for each row
execute function public.slevao_offer_price_alert_trigger();

drop trigger if exists price_alert_immediate_check on public.price_alerts;
create trigger price_alert_immediate_check
after insert or update of product_id, store_id, target_price, is_active
on public.price_alerts
for each row
execute function public.slevao_price_alert_trigger();

revoke all on function public.slevao_insert_price_notifications(uuid) from public, anon, authenticated;
revoke all on function public.slevao_offer_price_alert_trigger() from public, anon, authenticated;
revoke all on function public.slevao_price_alert_trigger() from public, anon, authenticated;
