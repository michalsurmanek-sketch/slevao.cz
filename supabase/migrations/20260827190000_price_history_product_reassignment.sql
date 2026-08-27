-- Preserve the old historical identity, but create a fresh price snapshot whenever
-- a mutable offer is reassigned to another master product. Without this, the new
-- product can inherit a live offer without any baseline in its own price history.
create or replace function public.record_offer_price()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT'
     or new.price is distinct from old.price
     or new.old_price is distinct from old.old_price
     or new.product_id is distinct from old.product_id then

    insert into public.price_history (
      product_id,
      store_id,
      branch_id,
      offer_id,
      price,
      old_price,
      unit_price,
      valid_from,
      valid_to,
      source_url
    )
    values (
      new.product_id,
      new.store_id,
      new.branch_id,
      new.id,
      new.price,
      new.old_price,
      new.unit_price,
      new.valid_from,
      new.valid_to,
      new.source_url
    );
  end if;

  return new;
end;
$function$;
