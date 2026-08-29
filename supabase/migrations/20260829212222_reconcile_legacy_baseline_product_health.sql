create or replace function private.reconcile_legacy_baseline_product_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $function$
declare
  r record;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_count integer;
  v_min_from date;
  v_max_to date;
  v_newest timestamptz;
  v_import_id uuid;
  v_source_adapter text;
  v_updated integer := 0;
begin
  for r in
    select st.store_id,s.slug,s.name
    from public.store_product_sync_state st
    join public.stores s on s.id=st.store_id
    where (
      st.health_reason like 'Aktuální počet publikovaných nabídek je nad nastaveným minimem; health baseline ověřena %'
      or st.adapter_name='legacy-baseline-reconcile-v1'
    )
      and (st.adapter_name is null or st.adapter_name='legacy-baseline-reconcile-v1')
  loop
    select count(*),min(o.valid_from),max(o.valid_to),max(o.updated_at)
      into v_count,v_min_from,v_max_to,v_newest
    from public.offers o
    where o.store_id=r.store_id
      and o.status='published'
      and o.valid_from<=v_today
      and o.valid_to>=v_today;

    select li.id,coalesce(li.metadata->>'adapter',li.metadata->>'parser')
      into v_import_id,v_source_adapter
    from public.leaflet_imports li
    where li.store_id=r.store_id
      and li.status='published'
      and coalesce(li.detected_valid_from,v_today)<=v_today
      and coalesce(li.detected_valid_to,v_today)>=v_today
    order by li.updated_at desc,li.created_at desc
    limit 1;

    update public.store_product_sync_state st
    set health_status=case when v_count>0 then 'ok' else 'waiting_source' end,
        health_reason=case
          when v_count>0 then format('%s: %s aktuálních publikovaných nabídek; legacy health baseline automaticky přepočítán.',r.name,v_count)
          else format('%s: dnes nejsou platné publikované nabídky; čeká se na nový zdroj.',r.name)
        end,
        last_offer_count=v_count,
        last_published_count=v_count,
        last_run_at=now(),
        last_success_at=case when v_count>0 then coalesce(greatest(st.last_success_at,v_newest),v_newest,now()) else st.last_success_at end,
        last_valid_from=v_min_from,
        last_valid_to=v_max_to,
        last_import_id=coalesce(v_import_id,st.last_import_id),
        adapter_name='legacy-baseline-reconcile-v1',
        adapter_version='v1',
        last_error=case when v_count>0 then null else st.last_error end,
        metadata=coalesce(st.metadata,'{}'::jsonb)||jsonb_build_object(
          'health_reconciler','legacy-baseline-reconcile-v1',
          'observed_source_adapter',v_source_adapter,
          'last_reconciled_at',now()
        ),
        updated_at=now()
    where st.store_id=r.store_id;

    v_updated:=v_updated+1;
  end loop;

  return jsonb_build_object('ok',true,'updated_stores',v_updated,'date',v_today);
end;
$function$;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='reconcile-legacy-baseline-product-health'
  loop perform cron.unschedule(r.jobid); end loop;
end $$;

select cron.schedule(
  'reconcile-legacy-baseline-product-health',
  '9,24,39,54 * * * *',
  $job$select private.reconcile_legacy_baseline_product_health();$job$
);

select private.reconcile_legacy_baseline_product_health();
