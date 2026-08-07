create or replace function public.slevao_products_equivalent(p_product_a uuid, p_product_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_product_a is not null
     and p_product_b is not null
     and (
       p_product_a = p_product_b
       or exists (
         select 1
         from public.product_equivalences e
         where e.is_active = true
           and e.confidence >= 0.99
           and least(e.product_id_a,e.product_id_b) = least(p_product_a,p_product_b)
           and greatest(e.product_id_a,e.product_id_b) = greatest(p_product_a,p_product_b)
       )
     );
$$;

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
  v_equivalent boolean;
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
    select pa.id, pa.user_id, pa.target_price, pa.product_id
    from public.price_alerts pa
    where pa.is_active = true
      and public.slevao_products_equivalent(pa.product_id, v_offer.product_id)
      and (pa.store_id is null or pa.store_id = v_offer.store_id)
      and v_offer.price <= pa.target_price
  loop
    v_notification_id := null;
    v_equivalent := v_alert.product_id is distinct from v_offer.product_id;

    insert into public.notifications(
      user_id, type, title, message, offer_id, product_id,
      price_alert_id, is_read, created_at
    ) values (
      v_alert.user_id,
      'price_drop',
      'Cena klesla na ' || trim(to_char(v_offer.price, 'FM999999990D00')) || ' Kč',
      case when v_equivalent then 'Ověřeně stejný výrobek: ' else '' end ||
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
    where public.slevao_products_equivalent(new.product_id, o.product_id)
      and o.status = 'published'
      and o.valid_to >= current_date
      and o.valid_from <= current_date + 7
      and o.price <= new.target_price
      and (new.store_id is null or o.store_id = new.store_id)
    order by
      case when o.valid_from <= current_date then 0 else 1 end,
      o.price asc,
      case when o.product_id = new.product_id then 0 else 1 end,
      o.valid_from asc
    limit 1;

    if v_offer_id is not null then
      perform public.slevao_insert_price_notifications(v_offer_id);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.slevao_products_equivalent(uuid,uuid) from public, anon, authenticated;
revoke all on function public.slevao_insert_price_notifications(uuid) from public, anon, authenticated;
revoke all on function public.slevao_price_alert_trigger() from public, anon, authenticated;
