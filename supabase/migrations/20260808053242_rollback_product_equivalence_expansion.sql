drop function if exists public.admin_list_product_equivalence_queue();
drop function if exists public.admin_list_product_equivalence_history();
drop function if exists public.admin_set_product_equivalence(uuid,uuid,boolean,text);

create or replace view public.product_equivalence_review_queue
with (security_invoker = true)
as
with recent as (
  select distinct on (o.product_id,o.store_id)
    o.product_id,
    o.store_id,
    s.name as store_name,
    o.title as offer_title,
    o.valid_from,
    o.valid_to,
    p.name as product_name,
    p.normalized_name,
    p.brand,
    p.quantity_text,
    public.normalize_product_name(p.brand) as brand_key,
    public.product_quantity_key(coalesce(p.quantity_text,o.title)) as quantity_key
  from public.offers o
  join public.products p on p.id=o.product_id
  join public.stores s on s.id=o.store_id
  where o.product_id is not null
    and o.is_verified = true
    and o.catalog_match_status in ('matched','retained')
    and o.valid_to >= current_date - 90
    and nullif(trim(p.brand),'') is not null
    and public.product_quantity_key(coalesce(p.quantity_text,o.title)) is not null
  order by o.product_id,o.store_id,o.valid_to desc,o.updated_at desc
), pairs as (
  select
    a.product_id as product_id_a,
    b.product_id as product_id_b,
    a.product_name as product_name_a,
    b.product_name as product_name_b,
    a.brand,
    a.quantity_key,
    a.store_name as store_a,
    b.store_name as store_b,
    a.offer_title as offer_title_a,
    b.offer_title as offer_title_b,
    greatest(a.valid_to,b.valid_to) as latest_valid_to
  from recent a
  join recent b
    on a.brand_key=b.brand_key
   and a.quantity_key=b.quantity_key
   and a.product_id::text < b.product_id::text
   and a.store_id <> b.store_id
)
select distinct
  p.product_id_a,
  p.product_id_b,
  p.product_name_a,
  p.product_name_b,
  p.brand,
  p.quantity_key,
  p.store_a,
  p.store_b,
  p.offer_title_a,
  p.offer_title_b,
  p.latest_valid_to,
  'manual_review_required'::text as review_status
from pairs p
where not exists (
  select 1
  from public.product_equivalences e
  where e.is_active=true
    and least(e.product_id_a,e.product_id_b)=least(p.product_id_a,p.product_id_b)
    and greatest(e.product_id_a,e.product_id_b)=greatest(p.product_id_a,p.product_id_b)
);

revoke all on public.product_equivalence_review_queue from anon, authenticated;

delete from public.product_equivalences
where is_active = false
  and confidence = 0
  and match_method = 'manual_review'
  and evidence->>'source' = 'curated_review_batch';

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
      'price_drop',
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

revoke all on function public.slevao_insert_price_notifications(uuid) from public, anon, authenticated;
revoke all on function public.slevao_price_alert_trigger() from public, anon, authenticated;
revoke all on function public.notify_favorite_product_offer() from public, anon, authenticated;

drop function if exists public.slevao_products_equivalent(uuid,uuid);
