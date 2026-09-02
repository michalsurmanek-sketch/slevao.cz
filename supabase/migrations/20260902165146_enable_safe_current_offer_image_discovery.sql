update public.product_image_automation_settings
set enabled = true,
    batch_size = 8,
    updated_at = now()
where id = true;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'discover-current-offer-images'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end
$$;

select cron.schedule(
  'discover-current-offer-images',
  '54 */3 * * *',
  $$select private.invoke_edge_function('discover-current-offer-images','{}'::jsonb,120000);$$
);
