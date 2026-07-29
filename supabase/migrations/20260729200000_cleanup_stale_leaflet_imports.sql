-- Slevao.cz: automatický úklid zaseknutých importů letáků.
-- Import, který se neposunul 45 minut, se bezpečně označí jako neúspěšný.
-- Při další skutečné změně zdroje vznikne nový import; nabídky se tímto nemažou.

create or replace function public.cleanup_stale_leaflet_imports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_count integer := 0;
begin
  update public.leaflet_imports
  set
    status = 'failed',
    error_message = coalesce(nullif(error_message, ''), 'Automatické zpracování se zaseklo a bylo bezpečně ukončeno.'),
    finished_at = now(),
    updated_at = now()
  where status in ('queued', 'downloading', 'processing', 'publishing')
    and updated_at < now() - interval '45 minutes';

  get diagnostics cleaned_count = row_count;
  return cleaned_count;
end;
$$;

revoke all on function public.cleanup_stale_leaflet_imports() from public;
grant execute on function public.cleanup_stale_leaflet_imports() to service_role;

do $$
declare
  job record;
begin
  for job in
    select jobid from cron.job where jobname = 'slevao-cleanup-stale-imports'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'slevao-cleanup-stale-imports',
  '*/15 * * * *',
  'select public.cleanup_stale_leaflet_imports();'
);

select public.cleanup_stale_leaflet_imports();
