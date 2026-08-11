-- Treat the persisted OCR pages as the source of truth for OCR completion.
-- This fixes imports where all pages were successfully OCR'd but the legacy
-- metadata flag was never written. It also gives JIP a service-only dispatcher
-- for immediate/cron-safe product extraction.

create or replace function public.refresh_leaflet_ocr_completion(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected integer := 0;
  v_actual integer := 0;
  v_complete boolean := false;
  v_engine text;
begin
  select greatest(
           coalesce(nullif(li.metadata ->> 'page_count','')::integer,0),
           case when jsonb_typeof(li.metadata -> 'page_image_urls')='array'
                then jsonb_array_length(li.metadata -> 'page_image_urls') else 0 end,
           coalesce(li.page_count,0)
         )
    into v_expected
  from public.leaflet_imports li
  where li.id=p_import_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','import_not_found');
  end if;

  select count(distinct page_number),min(engine)
    into v_actual,v_engine
  from public.leaflet_ocr_pages
  where import_id=p_import_id;

  v_complete := v_expected > 0 and v_actual >= v_expected;

  update public.leaflet_imports
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'ocr_complete',v_complete,
        'ocr_page_count',v_actual,
        'ocr_expected_page_count',v_expected,
        'ocr_engine',v_engine,
        'ocr_completion_checked_at',now(),
        'ocr_completed_at',case when v_complete then coalesce(metadata -> 'ocr_completed_at',to_jsonb(now())) else null end
      )),
      updated_at=now()
  where id=p_import_id;

  return jsonb_build_object('ok',true,'complete',v_complete,'pages',v_actual,'expected',v_expected,'engine',v_engine);
end;
$function$;

create or replace function public.refresh_leaflet_ocr_completion_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.refresh_leaflet_ocr_completion(coalesce(new.import_id,old.import_id));
  return coalesce(new,old);
end;
$function$;

drop trigger if exists trg_refresh_leaflet_ocr_completion on public.leaflet_ocr_pages;
create trigger trg_refresh_leaflet_ocr_completion
after insert or update or delete on public.leaflet_ocr_pages
for each row execute function public.refresh_leaflet_ocr_completion_trigger();

-- Backfill all imports that already have OCR pages.
do $block$
declare r record;
begin
  for r in select distinct import_id from public.leaflet_ocr_pages loop
    perform public.refresh_leaflet_ocr_completion(r.import_id);
  end loop;
end
$block$;

create or replace function public.trigger_jip_ocr_product_sync(p_dry_run boolean default false)
returns bigint
language plpgsql
security definer
set search_path to 'public','extensions','vault'
as $function$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret,'')='' then
    raise exception 'Vault secret slevao_cron_secret is missing.';
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-jip-ocr-products',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := jsonb_build_object('dry_run',coalesce(p_dry_run,false)),
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$function$;

revoke execute on function public.refresh_leaflet_ocr_completion(uuid) from public,anon,authenticated;
revoke execute on function public.trigger_jip_ocr_product_sync(boolean) from public,anon,authenticated;
grant execute on function public.refresh_leaflet_ocr_completion(uuid) to service_role;
grant execute on function public.trigger_jip_ocr_product_sync(boolean) to service_role;
