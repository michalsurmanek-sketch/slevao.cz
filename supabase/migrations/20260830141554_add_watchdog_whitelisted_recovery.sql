create table if not exists private.automation_watchdog_job_targets (
  jobname text primary key,
  max_silence interval not null,
  recovery_action text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
revoke all on table private.automation_watchdog_job_targets from public,anon,authenticated;

insert into private.automation_watchdog_job_targets(jobname,max_silence,recovery_action,enabled)
values
  ('slevao-rollover-supervisor',interval '12 minutes','rollover_supervisor',true),
  ('refresh-public-offer-search-cache',interval '12 minutes','search_cache_refresh',true),
  ('slevao-basic-pdf-parser',interval '20 minutes','basic_pdf_dispatch',true),
  ('slevao-discover-leaflets',interval '75 minutes','leaflet_discovery',true),
  ('slevao-leaflet-pipeline-v2',interval '7 hours','leaflet_pipeline',true)
on conflict(jobname) do update set
  max_silence=excluded.max_silence,
  recovery_action=excluded.recovery_action,
  enabled=excluded.enabled,
  updated_at=now();

create or replace function private.record_automation_watchdog_incident(
  p_fingerprint text,
  p_incident_type text,
  p_severity text default 'warning',
  p_store_slug text default null,
  p_job_id bigint default null,
  p_request_id bigint default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'private','public','pg_temp'
as $function$
begin
  insert into private.automation_watchdog_incidents(
    fingerprint,incident_type,severity,store_slug,job_id,request_id,status,
    first_seen_at,last_seen_at,resolved_at,occurrences,details
  ) values(
    p_fingerprint,p_incident_type,p_severity,p_store_slug,p_job_id,p_request_id,'open',
    now(),now(),null,1,coalesce(p_details,'{}'::jsonb)
  )
  on conflict(fingerprint) do update set
    incident_type=excluded.incident_type,
    severity=excluded.severity,
    store_slug=coalesce(excluded.store_slug,private.automation_watchdog_incidents.store_slug),
    job_id=coalesce(excluded.job_id,private.automation_watchdog_incidents.job_id),
    request_id=coalesce(excluded.request_id,private.automation_watchdog_incidents.request_id),
    status='open',
    last_seen_at=now(),
    resolved_at=null,
    occurrences=private.automation_watchdog_incidents.occurrences+1,
    details=coalesce(private.automation_watchdog_incidents.details,'{}'::jsonb)||coalesce(excluded.details,'{}'::jsonb);
end;
$function$;

create or replace function private.recover_known_automation_job(p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_request bigint;
  v_result jsonb;
begin
  case p_action
    when 'rollover_supervisor' then
      v_result := public.run_rollover_supervisor();
      return jsonb_build_object('handled',true,'action',p_action,'result',v_result);
    when 'search_cache_refresh' then
      v_result := private.refresh_public_offer_search_cache_if_dirty(false);
      return jsonb_build_object('handled',true,'action',p_action,'result',v_result);
    when 'basic_pdf_dispatch' then
      perform public.dispatch_pending_basic_leaflet_parsers(2);
      return jsonb_build_object('handled',true,'action',p_action);
    when 'leaflet_discovery' then
      v_request := public.trigger_leaflet_discovery();
      return jsonb_build_object('handled',true,'action',p_action,'request_id',v_request);
    when 'leaflet_pipeline' then
      v_request := public.trigger_leaflet_pipeline_v2();
      return jsonb_build_object('handled',true,'action',p_action,'request_id',v_request);
    else
      return jsonb_build_object('handled',false,'action',p_action,'reason','unknown_recovery_action');
  end case;
exception when others then
  return jsonb_build_object('handled',true,'action',p_action,'error',sqlerrm);
end;
$function$;
revoke all on function private.recover_known_automation_job(text) from public,anon,authenticated;

create or replace function private.run_automation_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','cron','net','pg_temp'
as $function$
declare
  v_run_id bigint;
  v_started timestamptz := clock_timestamp();
  v_stale_locks integer := 0;
  v_stale_imports integer := 0;
  v_stale_kaufland integer := 0;
  v_cron_incidents integer := 0;
  v_http_incidents integer := 0;
  v_health_incidents integer := 0;
  v_recovery_attempts integer := 0;
  v_recovery_errors integer := 0;
  v_resolved integer := 0;
  v_deleted_incidents integer := 0;
  v_deleted_runs integer := 0;
  v_fingerprint text;
  v_existing_recovery timestamptz;
  v_recovery jsonb;
  r record;
begin
  insert into private.automation_watchdog_runs(status) values('running') returning id into v_run_id;

  v_stale_locks := public.release_stale_product_sync_locks();
  v_stale_imports := public.cleanup_stale_leaflet_imports();
  v_stale_kaufland := public.cleanup_stale_kaufland_product_sync_audits(interval '30 minutes');

  for r in
    select t.jobname,t.max_silence,t.recovery_action,j.jobid,
           x.runid,x.status,x.start_time,x.end_time,x.return_message
    from private.automation_watchdog_job_targets t
    left join cron.job j on j.jobname=t.jobname and j.active=true
    left join lateral (
      select d.runid,d.status,d.start_time,d.end_time,d.return_message
      from cron.job_run_details d
      where d.jobid=j.jobid
      order by d.start_time desc
      limit 1
    ) x on true
    where t.enabled=true
  loop
    if r.jobid is null then
      v_fingerprint := format('critical-job-missing:%s',r.jobname);
      perform private.record_automation_watchdog_incident(
        v_fingerprint,'critical_job_missing','critical',null,null,null,
        jsonb_build_object('jobname',r.jobname,'recovery_action',r.recovery_action)
      );
      continue;
    end if;

    if r.runid is null or r.start_time < now()-r.max_silence or coalesce(r.status,'') <> 'succeeded' then
      v_fingerprint := format('critical-job:%s:%s',r.jobid,coalesce(r.runid,0));
      perform private.record_automation_watchdog_incident(
        v_fingerprint,
        case when r.runid is null or r.start_time < now()-r.max_silence then 'critical_job_stale' else 'cron_failure' end,
        'error',null,r.jobid,null,
        jsonb_build_object('jobname',r.jobname,'max_silence',r.max_silence,'recovery_action',r.recovery_action,
          'runid',r.runid,'status',r.status,'start_time',r.start_time,'end_time',r.end_time,
          'return_message',left(coalesce(r.return_message,''),1000))
      );

      select nullif(details->>'recovery_attempted_at','')::timestamptz into v_existing_recovery
      from private.automation_watchdog_incidents where fingerprint=v_fingerprint;

      if v_existing_recovery is null then
        v_recovery := private.recover_known_automation_job(r.recovery_action);
        v_recovery_attempts := v_recovery_attempts+1;
        if v_recovery ? 'error' then v_recovery_errors := v_recovery_errors+1; end if;
        perform private.record_automation_watchdog_incident(
          v_fingerprint,
          case when r.runid is null or r.start_time < now()-r.max_silence then 'critical_job_stale' else 'cron_failure' end,
          case when v_recovery ? 'error' then 'critical' else 'error' end,
          null,r.jobid,
          case when (v_recovery->>'request_id') ~ '^[0-9]+$' then (v_recovery->>'request_id')::bigint else null end,
          jsonb_build_object('recovery_attempted_at',now(),'recovery',v_recovery)
        );
      end if;
    end if;
  end loop;

  for r in
    with latest as (
      select distinct on (j.jobid)
        j.jobid,j.jobname,j.schedule,x.runid,x.status,x.start_time,x.end_time,x.return_message
      from cron.job j join cron.job_run_details x on x.jobid=j.jobid
      where j.active=true order by j.jobid,x.start_time desc
    )
    select * from latest
    where coalesce(status,'') <> 'succeeded'
      and start_time >= now()-interval '2 hours'
      and jobname not in (select jobname from private.automation_watchdog_job_targets where enabled)
  loop
    perform private.record_automation_watchdog_incident(
      format('cron:%s:%s',r.jobid,r.runid),'cron_failure','error',null,r.jobid,null,
      jsonb_build_object('jobname',r.jobname,'schedule',r.schedule,'runid',r.runid,'status',r.status,
        'start_time',r.start_time,'end_time',r.end_time,'return_message',left(coalesce(r.return_message,''),1000))
    );
    v_cron_incidents := v_cron_incidents+1;
  end loop;

  for r in
    select id,created,status_code,timed_out,error_msg,content
    from net._http_response
    where created >= now()-interval '20 minutes'
      and (coalesce(timed_out,false)=true or coalesce(status_code,0)>=400 or error_msg is not null)
  loop
    perform private.record_automation_watchdog_incident(
      format('http:%s',r.id),'http_failure',case when coalesce(r.timed_out,false) then 'error' else 'warning' end,
      null,null,r.id,jsonb_build_object('created',r.created,'status_code',r.status_code,'timed_out',r.timed_out,
        'error',left(coalesce(r.error_msg,''),1000),'content',left(coalesce(r.content,''),1200))
    );
    v_http_incidents := v_http_incidents+1;
  end loop;

  for r in
    select s.slug,st.store_id,st.last_offer_count,st.last_success_at,st.health_reason
    from public.store_product_sync_state st join public.stores s on s.id=st.store_id
    where st.health_status='ok'
      and not exists (
        select 1 from public.offers o
        where o.store_id=st.store_id and o.status='published' and o.is_verified=true
          and o.valid_from <= (now() at time zone 'Europe/Prague')::date
          and o.valid_to >= (now() at time zone 'Europe/Prague')::date
      )
  loop
    perform private.record_automation_watchdog_incident(
      format('health-zero:%s',r.slug),'health_ok_without_current_offers','critical',r.slug,null,null,
      jsonb_build_object('last_offer_count',r.last_offer_count,'last_success_at',r.last_success_at,'health_reason',r.health_reason)
    );
    v_health_incidents := v_health_incidents+1;
  end loop;

  update private.automation_watchdog_incidents
     set status='resolved',resolved_at=now()
   where status='open'
     and incident_type in ('cron_failure','http_failure','health_ok_without_current_offers','critical_job_stale')
     and last_seen_at < now()-interval '30 minutes';
  get diagnostics v_resolved = row_count;

  delete from private.automation_watchdog_incidents where status='resolved' and resolved_at < now()-interval '30 days';
  get diagnostics v_deleted_incidents = row_count;
  delete from private.automation_watchdog_runs where id<>v_run_id and started_at < now()-interval '30 days';
  get diagnostics v_deleted_runs = row_count;

  update private.automation_watchdog_runs
     set finished_at=clock_timestamp(),status='ok',summary=jsonb_build_object(
       'stale_locks_released',v_stale_locks,'stale_imports_cleaned',v_stale_imports,
       'stale_kaufland_audits_cleaned',v_stale_kaufland,'cron_incidents_seen',v_cron_incidents,
       'http_incidents_seen',v_http_incidents,'health_incidents_seen',v_health_incidents,
       'recovery_attempts',v_recovery_attempts,'recovery_errors',v_recovery_errors,
       'incidents_resolved',v_resolved,'old_incidents_deleted',v_deleted_incidents,
       'old_runs_deleted',v_deleted_runs,'duration_ms',round(extract(epoch from (clock_timestamp()-v_started))*1000)
     ) where id=v_run_id;

  return (select summary from private.automation_watchdog_runs where id=v_run_id);
exception when others then
  if v_run_id is not null then
    update private.automation_watchdog_runs
       set finished_at=clock_timestamp(),status='error',error_message=left(sqlerrm,2000),
           summary=jsonb_build_object('duration_ms',round(extract(epoch from (clock_timestamp()-v_started))*1000))
     where id=v_run_id;
  end if;
  raise;
end;
$function$;

revoke all on function private.run_automation_watchdog() from public,anon,authenticated;
