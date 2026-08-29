create or replace function public.normalize_pepco_collection_health()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_count integer := 0;
  v_latest_success timestamptz;
begin
  if exists (
    select 1 from public.stores s
    where s.id=new.store_id and s.slug='pepco'
  )
  and exists (
    select 1
    from public.leaflet_imports li
    where li.store_id=new.store_id
      and li.status='published'
      and li.metadata->>'adapter'='pepco-collection-html-v2'
      and li.detected_valid_from<=v_today
      and li.detected_valid_to>=v_today
      and li.product_count>0
  )
  then
    select count(*)
    into v_count
    from public.offers o
    where o.store_id=new.store_id
      and o.status='published'
      and o.valid_from<=v_today
      and o.valid_to>=v_today;

    select max(li.updated_at)
    into v_latest_success
    from public.leaflet_imports li
    where li.store_id=new.store_id
      and li.status='published'
      and li.metadata->>'adapter'='pepco-collection-html-v2'
      and li.detected_valid_from<=v_today
      and li.detected_valid_to>=v_today;

    if v_count>0 then
      new.health_status := 'ok';
      new.health_reason := format('Pepco: %s aktuálních produktů publikováno ze specializované oficiální letákové kolekce.',v_count);
      new.last_offer_count := v_count;
      new.last_published_count := v_count;
      new.last_success_at := coalesce(v_latest_success,new.last_success_at,now());
      new.last_error := null;
      new.last_parser_error := null;
      new.adapter_name := 'pepco-collection-html-v2';
      new.adapter_version := 'pepco-collection-html-v2';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_normalize_pepco_collection_health on public.store_product_sync_state;
create trigger trg_normalize_pepco_collection_health
before insert or update on public.store_product_sync_state
for each row execute function public.normalize_pepco_collection_health();

update public.store_product_sync_state st
set updated_at=now()
from public.stores s
where s.id=st.store_id and s.slug='pepco';
