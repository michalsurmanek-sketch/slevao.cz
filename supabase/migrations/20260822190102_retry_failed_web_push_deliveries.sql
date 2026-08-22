create or replace function public.retry_pending_web_push_notifications(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_cron_secret text;
  v_notification record;
  v_request_id bigint;
  v_enqueued integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  select ds.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets ds
  where ds.name = 'slevao_cron_secret'
  order by ds.created_at desc
  limit 1;

  if coalesce(v_cron_secret, '') = '' then
    raise warning 'Web Push retry skipped: slevao_cron_secret is missing.';
    return 0;
  end if;

  for v_notification in
    select n.id
    from public.notifications n
    where n.created_at >= now() - interval '6 hours'
      and exists (
        select 1
        from public.web_push_subscriptions s
        left join public.web_push_deliveries d
          on d.notification_id = n.id
         and d.subscription_id = s.id
        where s.user_id = n.user_id
          and s.is_active = true
          and coalesce(d.status, '') <> 'sent'
          and coalesce(d.attempts, 0) < 5
          and (d.last_attempt_at is null or d.last_attempt_at <= now() - interval '5 minutes')
      )
    order by n.created_at asc, n.id
    limit v_limit
  loop
    begin
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/web-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', v_cron_secret
        ),
        body := jsonb_build_object(
          'action', 'dispatch',
          'notification_id', v_notification.id
        ),
        timeout_milliseconds := 10000
      ) into v_request_id;
      v_enqueued := v_enqueued + 1;
    exception when others then
      raise warning 'Web Push retry enqueue failed for notification %: %', v_notification.id, sqlerrm;
    end;
  end loop;

  return v_enqueued;
end;
$function$;

revoke all on function public.retry_pending_web_push_notifications(integer) from public, anon, authenticated;
grant execute on function public.retry_pending_web_push_notifications(integer) to service_role;

do $block$
begin
  if exists (select 1 from cron.job where jobname = 'web-push-retry-pending') then
    perform cron.unschedule('web-push-retry-pending');
  end if;
  perform cron.schedule(
    'web-push-retry-pending',
    '*/5 * * * *',
    'select public.retry_pending_web_push_notifications(50);'
  );
end
$block$;
