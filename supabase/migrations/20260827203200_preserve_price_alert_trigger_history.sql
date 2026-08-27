-- Reusing an existing logical alert must not erase when it last produced a notification.

create or replace function public.merge_duplicate_active_price_alert()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_existing_id uuid;
begin
  if new.user_id is null or new.product_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'slevao-price-alert:' || new.user_id::text || ':' || new.product_id::text || ':' || coalesce(new.store_id::text, '*'),
      0
    )
  );

  select pa.id
  into v_existing_id
  from public.price_alerts pa
  where pa.user_id = new.user_id
    and pa.product_id = new.product_id
    and pa.store_id is not distinct from new.store_id
  order by pa.is_active desc, pa.created_at desc, pa.id
  limit 1
  for update;

  if v_existing_id is null then
    return new;
  end if;

  update public.price_alerts pa
  set target_price = new.target_price,
      search_term = coalesce(new.search_term, pa.search_term),
      is_active = coalesce(new.is_active, true),
      updated_at = now()
  where pa.id = v_existing_id;

  return null;
end;
$function$;
