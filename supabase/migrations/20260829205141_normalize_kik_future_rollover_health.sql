create or replace function public.normalize_kik_future_rollover_health()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_current_count integer := 0;
begin
  if new.health_reason like 'Nový KiK leták začne platit %'
     and exists (
       select 1 from public.stores s
       where s.id=new.store_id and s.slug='kik'
     )
  then
    select count(*)
    into v_current_count
    from public.offers o
    where o.store_id=new.store_id
      and o.status='published'
      and o.valid_from<=v_today
      and o.valid_to>=v_today;

    new.last_offer_count := v_current_count;
    new.last_published_count := v_current_count;
    new.last_success_at := coalesce(new.last_success_at, now());

    if v_current_count=0 then
      new.health_status := 'waiting_source';
      new.health_reason := replace(
        new.health_reason,
        'současné veřejné nabídky zůstávají beze změny.',
        'dnes nejsou platné KiK nabídky; čeká se na začátek nové platnosti.'
      );
    else
      new.health_status := 'ok';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_normalize_kik_future_rollover_health on public.store_product_sync_state;
create trigger trg_normalize_kik_future_rollover_health
before insert or update on public.store_product_sync_state
for each row
execute function public.normalize_kik_future_rollover_health();

update public.store_product_sync_state st
set health_status='waiting_source',
    health_reason=replace(
      st.health_reason,
      'současné veřejné nabídky zůstávají beze změny.',
      'dnes nejsou platné KiK nabídky; čeká se na začátek nové platnosti.'
    ),
    last_offer_count=0,
    last_published_count=0,
    last_success_at=coalesce(st.last_success_at,now()),
    updated_at=now()
from public.stores s
where s.id=st.store_id
  and s.slug='kik'
  and st.health_reason like 'Nový KiK leták začne platit %'
  and not exists (
    select 1 from public.offers o
    where o.store_id=st.store_id
      and o.status='published'
      and o.valid_from<=(now() at time zone 'Europe/Prague')::date
      and o.valid_to>=(now() at time zone 'Europe/Prague')::date
  );
