create table if not exists private.automation_watchdog_store_targets (
  store_slug text primary key,
  recovery_action text not null,
  cooldown interval not null default interval '1 hour',
  enabled boolean not null default true,
  last_recovery_at timestamptz,
  last_recovery_status text,
  last_recovery_details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
revoke all on table private.automation_watchdog_store_targets from public,anon,authenticated;

insert into private.automation_watchdog_store_targets(store_slug,recovery_action,cooldown,enabled)
values
  ('globus','globus_products',interval '1 hour',true),
  ('hm','hm_products',interval '2 hours',true),
  ('makro','makro_source',interval '1 hour',true),
  ('pilulka','pilulka_products',interval '2 hours',true),
  ('zabka','zabka_products',interval '2 hours',true),
  ('kosik','kosik_products',interval '1 hour',true),
  ('intersport','intersport_products',interval '2 hours',true),
  ('pro-doma','pro_doma_verified',interval '1 hour',true)
on conflict(store_slug) do update set
  recovery_action=excluded.recovery_action,
  cooldown=excluded.cooldown,
  enabled=excluded.enabled,
  updated_at=now();

create or replace function private.recover_known_store_automation(p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_request bigint;
begin
  case p_action
    when 'globus_products' then
      v_request := private.invoke_edge_function('sync-globus-products',jsonb_build_object('dry_run',false),120000);
    when 'hm_products' then
      v_request := private.invoke_edge_function('sync-hm-products',jsonb_build_object('dry_run',false),120000);
    when 'makro_source' then
      v_request := private.invoke_edge_function('sync-makro-source','{}'::jsonb,120000);
    when 'pilulka_products' then
      v_request := private.invoke_edge_function('sync-pilulka-products',jsonb_build_object('dry_run',false),120000);
    when 'zabka_products' then
      v_request := private.invoke_edge_function('sync-zabka-products','{}'::jsonb,120000);
    when 'kosik_products' then
      v_request := private.invoke_edge_function('sync-kosik-products','{}'::jsonb,120000);
    when 'intersport_products' then
      v_request := public.invoke_intersport_products_sync();
    when 'pro_doma_verified' then
      v_request := public.trigger_pro_doma_verified_sync();
    else
      return jsonb_build_object('handled',false,'action',p_action,'reason','unknown_store_recovery_action');
  end case;

  return jsonb_build_object('handled',true,'action',p_action,'request_id',v_request);
exception when others then
  return jsonb_build_object('handled',true,'action',p_action,'error',sqlerrm);
end;
$function$;
revoke all on function private.recover_known_store_automation(text) from public,anon,authenticated;

create or replace function private.recover_watchdog_store_errors()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  r record;
  v_result jsonb;
  v_attempted integer := 0;
  v_errors integer := 0;
  v_skipped_cooldown integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  for r in
    select i.id as incident_id,i.fingerprint,i.store_slug,i.details,
           t.recovery_action,t.cooldown,t.last_recovery_at
    from private.automation_watchdog_incidents i
    join private.automation_watchdog_store_targets t on t.store_slug=i.store_slug
    where i.status='open'
      and i.incident_type='store_health_error'
      and t.enabled=true
    order by i.last_seen_at desc
  loop
    if r.last_recovery_at is not null and r.last_recovery_at > now()-r.cooldown then
      v_skipped_cooldown := v_skipped_cooldown+1;
      continue;
    end if;

    v_result := private.recover_known_store_automation(r.recovery_action);
    v_attempted := v_attempted+1;
    if v_result ? 'error' then v_errors := v_errors+1; end if;

    update private.automation_watchdog_store_targets
       set last_recovery_at=now(),
           last_recovery_status=case when v_result ? 'error' then 'error' else 'triggered' end,
           last_recovery_details=v_result,
           updated_at=now()
     where store_slug=r.store_slug;

    perform private.record_automation_watchdog_incident(
      r.fingerprint,
      'store_health_error',
      case when v_result ? 'error' then 'critical' else 'error' end,
      r.store_slug,null,
      case when (v_result->>'request_id') ~ '^[0-9]+$' then (v_result->>'request_id')::bigint else null end,
      jsonb_build_object('store_recovery_attempted_at',now(),'store_recovery',v_result)
    );

    v_items := v_items || jsonb_build_array(jsonb_build_object('store',r.store_slug,'recovery',v_result));
  end loop;

  return jsonb_build_object('attempted',v_attempted,'errors',v_errors,'skipped_cooldown',v_skipped_cooldown,'items',v_items);
end;
$function$;
revoke all on function private.recover_watchdog_store_errors() from public,anon,authenticated;

create or replace function private.run_automation_watchdog_cycle()
returns jsonb
language plpgsql
security definer
set search_path to 'private','public','pg_temp'
as $function$
declare
  v_watchdog jsonb;
  v_store_recovery jsonb;
begin
  v_watchdog := private.run_automation_watchdog();
  v_store_recovery := private.recover_watchdog_store_errors();
  return jsonb_build_object('watchdog',v_watchdog,'store_recovery',v_store_recovery);
end;
$function$;
revoke all on function private.run_automation_watchdog_cycle() from public,anon,authenticated;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-automation-watchdog';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-automation-watchdog',
    '6,16,26,36,46,56 * * * *',
    $cron$select private.run_automation_watchdog_cycle();$cron$
  );
end $$;
