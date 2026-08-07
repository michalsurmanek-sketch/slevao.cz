do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'slevao-kik-products' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'slevao-kik-products',
    '11,26,41,56 * * * *',
    'select public.trigger_kik_product_sync(false,false);'
  );
end;
$$;
