create or replace function private.archive_terminal_structured_retail_http_jobs(
  p_main_age interval default interval '14 days',
  p_history_age interval default interval '90 days',
  p_limit integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_main_age interval := greatest(coalesce(p_main_age,interval '14 days'),interval '1 day');
  v_history_age interval := greatest(coalesce(p_history_age,interval '90 days'),interval '30 days');
  v_limit integer := greatest(1,least(coalesce(p_limit,2000),10000));
  v_archived integer := 0;
  v_pruned integer := 0;
begin
  with picked as materialized (
    select j.request_id
    from public.structured_retail_http_jobs j
    where j.status in ('completed','failed')
      and j.requested_at < now()-v_main_age
    order by j.requested_at,j.request_id
    limit v_limit
    for update skip locked
  ), ins as (
    insert into private.structured_retail_http_job_history(
      request_id,store_id,adapter,status,requested_at,processed_at,error_message,metadata,archive_reason
    )
    select j.request_id,j.store_id,j.adapter,j.status,j.requested_at,j.processed_at,j.error_message,
           coalesce(j.metadata,'{}'::jsonb),'age_retention'
    from public.structured_retail_http_jobs j
    join picked p on p.request_id=j.request_id
    returning request_id
  ), del as (
    delete from public.structured_retail_http_jobs j
    using ins i
    where j.request_id=i.request_id
    returning j.request_id
  )
  select count(*)::integer into v_archived from del;

  with old_history as materialized (
    select h.id
    from private.structured_retail_http_job_history h
    where h.archived_at < now()-v_history_age
    order by h.archived_at,h.id
    limit 5000
  ), del_history as (
    delete from private.structured_retail_http_job_history h
    using old_history x
    where h.id=x.id
    returning h.id
  )
  select count(*)::integer into v_pruned from del_history;

  return jsonb_build_object(
    'ok',true,
    'archived',v_archived,
    'history_pruned',v_pruned,
    'main_retention_days',extract(epoch from v_main_age)/86400,
    'history_retention_days',extract(epoch from v_history_age)/86400
  );
end;
$function$;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='archive-terminal-structured-http-jobs';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'archive-terminal-structured-http-jobs',
    '57 3 * * *',
    $cron$select private.archive_terminal_structured_retail_http_jobs();$cron$
  );
end $$;

select private.archive_terminal_structured_retail_http_jobs();
