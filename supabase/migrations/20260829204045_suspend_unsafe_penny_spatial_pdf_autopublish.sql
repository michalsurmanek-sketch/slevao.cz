do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='slevao-penny-spatial-pdf-products'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;
