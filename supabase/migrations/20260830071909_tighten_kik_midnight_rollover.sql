do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-kik-products';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-kik-products',
    '1,16,31,46 * * * *',
    $cron$select private.invoke_edge_function('sync-kik-products',jsonb_build_object('dry_run',false,'force',false),120000);$cron$
  );
end $$;
