create or replace function public.reconcile_dm_rossmann_overlapping_snapshots()
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_store_id uuid;
  v_offer_count integer := 0;
  v_min_from date;
  v_max_to date;
  v_newest timestamptz;
  v_latest_import uuid;
  v_slug text;
  v_adapter text;
begin
  with ranked as (
    select o.id,
           row_number() over (
             partition by o.store_id,o.product_id,o.coverage_scope,
                          coalesce(o.region_code,''),coalesce(o.city_name,''),coalesce(o.store_location_name,'')
             order by o.valid_from desc,o.valid_to desc,coalesce(o.published_at,o.created_at) desc,o.id desc
           ) as rn,
           count(*) over (
             partition by o.store_id,o.product_id,o.coverage_scope,
                          coalesce(o.region_code,''),coalesce(o.city_name,''),coalesce(o.store_location_name,'')
           ) as grp_count
    from public.offers o
    join public.stores s on s.id=o.store_id
    where s.slug in ('dm','rossmann')
      and o.status='published'
      and o.product_id is not null
      and o.valid_from <= (now() at time zone 'Europe/Prague')::date
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  ), upd as (
    update public.offers o
       set status='expired',
           metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
             'deduplicated_overlap_at',now(),
             'deduplicated_overlap_reason','older continuous-store snapshot'
           )
      from ranked r
     where o.id=r.id and r.grp_count>1 and r.rn>1
     returning o.id
  )
  select count(*) into v_count from upd;

  foreach v_slug in array array['dm','rossmann'] loop
    select id into v_store_id
    from public.stores
    where slug=v_slug
    limit 1;

    if v_store_id is null then
      continue;
    end if;

    select count(*),min(valid_from),max(valid_to),max(updated_at)
      into v_offer_count,v_min_from,v_max_to,v_newest
    from public.offers
    where store_id=v_store_id
      and status='published'
      and valid_from <= (now() at time zone 'Europe/Prague')::date
      and valid_to >= (now() at time zone 'Europe/Prague')::date;

    if v_slug='dm' then
      v_adapter := 'dm-product-api-v2';
    else
      v_adapter := 'rossmann-html-v1';
    end if;

    select li.id into v_latest_import
    from public.leaflet_imports li
    where li.store_id=v_store_id
      and li.status='published'
      and li.metadata->>'adapter'=v_adapter
      and coalesce(li.detected_valid_from,(now() at time zone 'Europe/Prague')::date) <= (now() at time zone 'Europe/Prague')::date
      and coalesce(li.detected_valid_to,(now() at time zone 'Europe/Prague')::date) >= (now() at time zone 'Europe/Prague')::date
    order by li.updated_at desc,li.created_at desc
    limit 1;

    update public.store_product_sync_state st
    set health_status=case when v_offer_count>0 then 'ok' else 'waiting_source' end,
        health_reason=case
          when v_offer_count>0 and v_slug='dm' then format('dm drogerie markt: %s aktuálních publikovaných nabídek po odstranění překryvů snapshotů.',v_offer_count)
          when v_offer_count>0 then format('Rossmann: %s aktuálních publikovaných nabídek po odstranění překryvů snapshotů.',v_offer_count)
          when v_slug='dm' then 'dm drogerie markt: dnes nejsou platné publikované nabídky; čeká se na nový zdroj.'
          else 'Rossmann: dnes nejsou platné publikované nabídky; čeká se na nový zdroj.'
        end,
        last_offer_count=v_offer_count,
        last_published_count=v_offer_count,
        last_run_at=now(),
        last_success_at=case when v_offer_count>0 then coalesce(greatest(st.last_success_at,v_newest),v_newest,now()) else st.last_success_at end,
        last_valid_from=v_min_from,
        last_valid_to=v_max_to,
        last_import_id=coalesce(v_latest_import,st.last_import_id),
        adapter_name=v_adapter,
        adapter_version=case when v_slug='dm' then 'v2' else 'v1' end,
        last_error=case when v_offer_count>0 then null else st.last_error end,
        updated_at=now()
    where st.store_id=v_store_id;
  end loop;

  return v_count;
end;
$function$;
