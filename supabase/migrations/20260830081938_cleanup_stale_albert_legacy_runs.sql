create or replace function public.cleanup_stale_albert_legacy_runs(p_age interval default interval '90 minutes')
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_count integer := 0;
begin
  with upd as (
    update public.albert_product_sync_runs r
       set status='failed',
           finished_at=now(),
           error_message='Legacy Albert PDF AI běh automaticky ukončen po překročení časového limitu; současná Publitas pipeline je oddělená.',
           metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
             'legacy_cleanup_at',now(),
             'legacy_cleanup_reason','stale_retired_albert_pdf_ai_run'
           )
     where r.status='running'
       and r.started_at < now()-greatest(coalesce(p_age,interval '90 minutes'),interval '15 minutes')
       and r.metadata->>'adapter'='albert-pdf-ai-v2'
    returning r.id
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$function$;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cleanup-stale-albert-legacy-runs';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'cleanup-stale-albert-legacy-runs',
    '37 3 * * *',
    $cron$select public.cleanup_stale_albert_legacy_runs();$cron$
  );
end $$;

select public.cleanup_stale_albert_legacy_runs();