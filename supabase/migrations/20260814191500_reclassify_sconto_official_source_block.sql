do $$
declare
  v_store_id uuid;
  v_keep_id uuid;
begin
  select id into v_store_id from public.stores where slug='sconto';
  if v_store_id is null then raise exception 'Sconto store not found'; end if;

  select id into v_keep_id
  from public.leaflet_sources
  where store_id=v_store_id
  order by created_at desc
  limit 1;

  if v_keep_id is not null then
    update public.leaflet_sources
    set source_url='https://www.sconto.cz/letak',
        name='Sconto – oficiální leták',
        source_type='html',
        is_active=false,
        auto_publish=false,
        automation_mode='blocked',
        disabled_reason='Oficiální /letak existuje, ale serverové načítání v Edge runtime blokuje CloudFront HTTP 403.',
        last_checked_at=now(),
        last_error='HTTP 403 CloudFront při serverovém načítání https://www.sconto.cz/letak',
        updated_at=now()
    where id=v_keep_id;
  end if;

  update public.leaflet_sources
  set is_active=false,
      auto_publish=false,
      automation_mode='blocked',
      disabled_reason='Nahrazeno kanonickým zdrojem https://www.sconto.cz/letak; serverové načítání je blokováno HTTP 403.',
      updated_at=now()
  where store_id=v_store_id and id is distinct from v_keep_id;

  insert into public.store_product_sync_state(
    store_id,last_run_at,last_offer_count,last_published_count,last_error,last_parser_error,
    health_status,health_reason,source_type,source_category,adapter_name,adapter_version,updated_at,is_running,run_started_at,metadata
  ) values (
    v_store_id,now(),0,0,
    'HTTP 403 CloudFront při serverovém načítání https://www.sconto.cz/letak',
    null,'blocked',
    'Sconto: oficiální /letak existuje, ale CloudFront blokuje serverové načítání HTTP 403; automatický produktový zdroj nelze bezpečně číst.',
    'official-html','current-offers','sconto-official-html','blocked-403',now(),false,null,
    jsonb_build_object('source_url','https://www.sconto.cz/letak','verified_date','2026-08-14','block_reason','cloudfront_403')
  )
  on conflict(store_id) do update set
    last_run_at=excluded.last_run_at,
    last_offer_count=0,
    last_published_count=0,
    last_error=excluded.last_error,
    last_parser_error=null,
    health_status='blocked',
    health_reason=excluded.health_reason,
    source_type=excluded.source_type,
    source_category=excluded.source_category,
    adapter_name=excluded.adapter_name,
    adapter_version=excluded.adapter_version,
    metadata=excluded.metadata,
    is_running=false,
    run_started_at=null,
    updated_at=excluded.updated_at;
end $$;
