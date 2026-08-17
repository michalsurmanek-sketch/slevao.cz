do $$
declare v_job_id bigint; v_store_id uuid;
begin
  select jobid into v_job_id from cron.job where jobname='sync-planeo-if-stale-hourly';
  if v_job_id is not null then
    perform cron.alter_job(job_id := v_job_id, schedule := '17 */6 * * *');
  end if;

  select id into v_store_id from public.stores where slug='planeo';
  if v_store_id is not null then
    update public.store_product_sync_state
       set health_status='waiting_source',
           health_reason='PLANEO nemá potvrzenou aktuální výprodejovou kampaň; poslední známá skončila 2026-08-14. Zdroj se kontroluje každých 6 hodin.',
           last_error='Čeká se na novou potvrzenou PLANEO kampaň.',
           is_running=false,
           updated_at=now()
     where store_id=v_store_id;
  end if;
end $$;
