create or replace function public.normalize_pepco_collection_health()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_count integer := 0;
  v_source_success timestamptz;
  v_import public.leaflet_imports%rowtype;
begin
  if not exists (
    select 1 from public.stores s where s.id=new.store_id and s.slug='pepco'
  ) then
    return new;
  end if;

  select li.* into v_import
  from public.leaflet_imports li
  where li.store_id=new.store_id
    and li.status='published'
    and li.metadata->>'adapter'='pepco-collection-html-v2'
    and li.detected_valid_from<=v_today
    and li.detected_valid_to>=v_today
    and li.product_count>0
  order by li.updated_at desc
  limit 1;

  if v_import.id is null then
    return new;
  end if;

  select count(*) into v_count
  from public.offers o
  where o.store_id=new.store_id
    and o.status='published'
    and o.valid_from<=v_today
    and o.valid_to>=v_today;

  select max(ls.last_success_at) into v_source_success
  from public.leaflet_sources ls
  where ls.store_id=new.store_id
    and ls.source_url='https://pepco.cz/kolekce/letaky/'
    and ls.is_active=true;

  if v_count>0 then
    new.health_status := 'ok';
    new.health_reason := format('Pepco: %s aktuálních produktů publikováno ze specializované oficiální letákové kolekce.',v_count);
    new.last_offer_count := v_count;
    new.last_published_count := v_count;
    new.last_success_at := coalesce(v_source_success,v_import.updated_at,new.last_success_at,now());
    new.last_valid_from := v_import.detected_valid_from;
    new.last_valid_to := v_import.detected_valid_to;
    new.last_import_id := v_import.id;
    new.parser_version := 'pepco-collection-html-v2';
    new.adapter_name := 'pepco-collection-html-v2';
    new.adapter_version := 'pepco-collection-html-v2';
    new.last_error := null;
    new.last_parser_error := null;
  end if;
  return new;
end;
$function$;
