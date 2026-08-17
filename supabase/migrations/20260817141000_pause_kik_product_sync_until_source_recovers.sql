do $$
declare v_store_id uuid; v_job_id bigint;
begin
  select id into v_store_id from public.stores where slug='kik';
  if v_store_id is not null then
    update public.leaflet_sources
       set is_active=false,
           disabled_reason='External Publitas source currently returns no active publication; paused to prevent repeated production 500s.',
           next_review_at=now()+interval '12 hours',
           last_checked_at=now(),
           last_error='KiK source temporarily paused: no active Publitas publication returned.'
     where store_id=v_store_id
       and source_url='https://www.kik.cz/tvuj-online-letak'
       and is_active=true;

    update public.store_product_sync_state
       set health_status='waiting_source',
           health_reason='KiK external Publitas source currently exposes no active publication; last healthy public offers are preserved.',
           last_error='KiK source temporarily paused: no active Publitas publication returned.',
           is_running=false,
           updated_at=now()
     where store_id=v_store_id;
  end if;

  select jobid into v_job_id from cron.job where jobname='slevao-kik-products';
  if v_job_id is not null then
    perform cron.alter_job(job_id := v_job_id, active := false);
  end if;
end $$;
