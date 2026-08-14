create or replace function private.refresh_planeo_if_stale()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_store_id uuid;
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_current integer := 0;
  v_request_id bigint;
begin
  select id into v_store_id from public.stores where slug='planeo';
  if v_store_id is null then
    return jsonb_build_object('ok',false,'reason','store_missing');
  end if;

  select count(*) into v_current
  from public.offers
  where store_id=v_store_id
    and status='published'
    and is_verified=true
    and valid_from<=v_today
    and valid_to>=v_today;

  if v_current>0 then
    return jsonb_build_object('ok',true,'action','skip','current_offers',v_current,'date',v_today);
  end if;

  v_request_id := public.invoke_planeo_products_sync();
  return jsonb_build_object('ok',true,'action','requested','request_id',v_request_id,'date',v_today);
end;
$function$;

revoke all on function private.refresh_planeo_if_stale() from public, anon, authenticated;
grant execute on function private.refresh_planeo_if_stale() to postgres, service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='sync-planeo-verified-products';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  select jobid into v_job from cron.job where jobname='sync-planeo-if-stale-hourly';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('sync-planeo-if-stale-hourly','15 * * * *','select private.refresh_planeo_if_stale();');
end $$;
