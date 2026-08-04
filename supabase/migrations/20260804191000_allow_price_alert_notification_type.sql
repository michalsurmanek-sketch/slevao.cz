alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array['price_drop'::text, 'price_alert'::text, 'offer_expiring'::text, 'new_offer'::text, 'system'::text]));

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

revoke all on function public.slevao_insert_price_notifications(uuid) from public, anon, authenticated;
