-- Jeden aktivní cenový hlídač pro stejný produkt a stejný rozsah obchodu.
-- Opakované kliknutí uživatele pouze upraví cílovou cenu existujícího hlídače.

create or replace function public.merge_duplicate_active_price_alert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_id uuid;
begin
  if new.user_id is null or new.product_id is null or coalesce(new.is_active, true) is not true then
    return new;
  end if;

  select pa.id into v_existing_id
  from public.price_alerts pa
  where pa.user_id = new.user_id
    and pa.product_id = new.product_id
    and pa.is_active = true
    and pa.store_id is not distinct from new.store_id
  order by pa.created_at desc, pa.id
  limit 1
  for update;

  if v_existing_id is null then
    return new;
  end if;

  update public.price_alerts
  set target_price = new.target_price,
      search_term = coalesce(new.search_term, search_term),
      is_active = true
  where id = v_existing_id;

  -- BEFORE INSERT: NULL znamená, že se duplicitní řádek nevytvoří.
  return null;
end;
$function$;

drop trigger if exists trg_merge_duplicate_active_price_alert on public.price_alerts;
create trigger trg_merge_duplicate_active_price_alert
before insert on public.price_alerts
for each row execute function public.merge_duplicate_active_price_alert();

-- Úklid případných historických duplicit: nechá nejnovější aktivní řádek.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, product_id, store_id
           order by created_at desc, id desc
         ) as rn
  from public.price_alerts
  where is_active = true and product_id is not null
)
update public.price_alerts pa
set is_active = false
from ranked r
where pa.id = r.id and r.rn > 1;
