do $$
declare
  r record;
begin
  for r in
    select jobid, jobname
    from cron.job
    where jobname in (
      'slevao-discover-leaflets',
      'slevao-cleanup-stale-imports',
      'slevao-dispatch-leaflet-imports',
      'slevao-basic-pdf-parser',
      'slevao-archive-expired-document-leaflets',
      'slevao-leaflet-pipeline-v2'
    )
  loop
    perform cron.alter_job(
      r.jobid,
      schedule := case r.jobname
        when 'slevao-discover-leaflets' then '7 * * * *'
        when 'slevao-cleanup-stale-imports' then '12 * * * *'
        when 'slevao-dispatch-leaflet-imports' then '*/5 * * * *'
        when 'slevao-basic-pdf-parser' then '3,13,23,33,43,53 * * * *'
        when 'slevao-archive-expired-document-leaflets' then '20 0 * * *'
        when 'slevao-leaflet-pipeline-v2' then '5 1,7,13,19 * * *'
      end
    );
  end loop;
end;
$$;
