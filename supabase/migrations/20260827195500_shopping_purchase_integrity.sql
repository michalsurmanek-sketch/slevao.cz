create or replace function public.validate_shopping_purchase_snapshot()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_purchase_date date := (timezone('Europe/Prague', new.completed_at))::date;
begin
  if jsonb_typeof(new.items) <> 'array' then
    raise exception 'Historie nákupu musí obsahovat pole položek.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.items) as item(value)
    where nullif(item.value->>'offer_id', '') is not null
      and not exists (
        select 1
        from public.offers o
        where o.id = (item.value->>'offer_id')::uuid
          and o.status = 'published'
          and o.is_verified = true
          and o.valid_from <= v_purchase_date
          and o.valid_to >= v_purchase_date
          and (
            nullif(item.value->>'product_id', '') is null
            or o.product_id = (item.value->>'product_id')::uuid
          )
          and (
            nullif(item.value->>'price', '') is null
            or abs(o.price - (item.value->>'price')::numeric) <= 0.01
          )
      )
  ) then
    raise exception 'Historie obsahuje nabídku, která v den nákupu nebyla platná nebo nesouhlasí s uloženou cenou.';
  end if;

  return new;
end;
$function$;

drop trigger if exists shopping_purchase_snapshot_check on public.shopping_list_purchases;
create trigger shopping_purchase_snapshot_check
before insert or update of items, completed_at
on public.shopping_list_purchases
for each row
execute function public.validate_shopping_purchase_snapshot();
