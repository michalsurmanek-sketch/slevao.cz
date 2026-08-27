DO $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-auto-reclassify-products' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-auto-reclassify-products',
    '7 * * * *',
    'select private.auto_reclassify_products(1000);'
  );
end $$;
