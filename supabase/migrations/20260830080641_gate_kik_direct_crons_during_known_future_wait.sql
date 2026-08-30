create or replace function private.kik_future_publication_pending()
returns boolean
language sql
stable
security definer
set search_path to 'public','private','pg_temp'
as $function$
  select exists (
    select 1
    from public.store_product_sync_state st
    join public.stores s on s.id=st.store_id
    where s.slug='kik'
      and st.health_status='waiting_source'
      and st.last_valid_from is not null
      and st.last_valid_from>(now() at time zone 'Europe/Prague')::date
  );
$function$;

create or replace function private.trigger_kik_source_if_due()
returns bigint
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
  if private.kik_future_publication_pending() then
    return null;
  end if;
  return private.invoke_edge_function('sync-kik-source','{}'::jsonb,120000);
end;
$function$;

create or replace function private.trigger_kik_products_if_due()
returns bigint
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
  if private.kik_future_publication_pending() then
    return null;
  end if;
  return private.invoke_edge_function('sync-kik-products',jsonb_build_object('dry_run',false,'force',false),120000);
end;
$function$;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='slevao-kik-source';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-kik-source',
    '8,23,38,53 * * * *',
    $cron$select private.trigger_kik_source_if_due();$cron$
  );

  select jobid into v_job from cron.job where jobname='slevao-kik-products';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'slevao-kik-products',
    '1,16,31,46 * * * *',
    $cron$select private.trigger_kik_products_if_due();$cron$
  );
end $$;