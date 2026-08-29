create or replace function public.normalize_planeo_stavmat_waiting_counts()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_catalog'
as $function$
declare
  v_slug text;
  v_current integer;
begin
  if new.health_status<>'waiting_source' then return new; end if;

  select slug into v_slug from public.stores where id=new.store_id;
  if v_slug not in ('planeo','stavmat') then return new; end if;

  select count(*) into v_current
  from public.offers o
  where o.store_id=new.store_id
    and o.status='published'
    and o.valid_from<=(now() at time zone 'Europe/Prague')::date
    and o.valid_to>=(now() at time zone 'Europe/Prague')::date;

  new.last_offer_count:=v_current;
  new.last_published_count:=v_current;
  return new;
end;
$function$;

drop trigger if exists trg_normalize_planeo_stavmat_waiting_counts on public.store_product_sync_state;
create trigger trg_normalize_planeo_stavmat_waiting_counts
before insert or update on public.store_product_sync_state
for each row execute function public.normalize_planeo_stavmat_waiting_counts();

update public.store_product_sync_state st
set last_offer_count=0,last_published_count=0,updated_at=now()
from public.stores s
where s.id=st.store_id
  and s.slug in ('planeo','stavmat')
  and st.health_status='waiting_source'
  and not exists (
    select 1 from public.offers o
    where o.store_id=st.store_id
      and o.status='published'
      and o.valid_from<=(now() at time zone 'Europe/Prague')::date
      and o.valid_to>=(now() at time zone 'Europe/Prague')::date
  );
