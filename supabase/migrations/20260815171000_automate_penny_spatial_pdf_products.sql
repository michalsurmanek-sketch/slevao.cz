-- Keep the complete PENNY PDF and its deterministic spatial product parser
-- independent from the small structured HTML promotion feed.

create or replace function public.trigger_penny_pdf_product_pipeline()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  v_secret text;
  v_discovery_request bigint;
  v_parser_request bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(v_secret,'')='' then
    raise exception 'Cron secret is not configured.';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/discover-leaflets',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body := jsonb_build_object('store_slug','penny','force',true),
    timeout_milliseconds := 120000
  ) into v_discovery_request;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-penny-pdf-products',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_parser_request;

  return jsonb_build_object(
    'discovery_request_id',v_discovery_request,
    'parser_request_id',v_parser_request
  );
end;
$function$;

revoke all on function public.trigger_penny_pdf_product_pipeline() from public, anon, authenticated;
grant execute on function public.trigger_penny_pdf_product_pipeline() to service_role;

do $schedule$
begin
  if exists(select 1 from cron.job where jobname='slevao-penny-spatial-pdf-products') then
    perform cron.unschedule('slevao-penny-spatial-pdf-products');
  end if;
  perform cron.schedule(
    'slevao-penny-spatial-pdf-products',
    '17 */2 * * *',
    'select public.trigger_penny_pdf_product_pipeline();'
  );
end;
$schedule$;

comment on function public.trigger_penny_pdf_product_pipeline() is
  'Discovers the full PENNY PDF and runs deterministic coordinate-based product extraction.';
