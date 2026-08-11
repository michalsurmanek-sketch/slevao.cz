-- Automatically remove expired leaflet source files from Supabase Storage
-- while preserving offer/price history and a compact audit trail.

create table if not exists public.leaflet_storage_cleanup_log (
  id bigserial primary key,
  import_id uuid null references public.leaflet_imports(id) on delete set null,
  bucket text not null,
  path text not null,
  bytes bigint not null default 0,
  cleanup_type text not null check (cleanup_type in ('expired_import','orphan')),
  status text not null default 'deleted',
  error_message text null,
  deleted_at timestamptz not null default now()
);

create index if not exists leaflet_storage_cleanup_log_deleted_at_idx
  on public.leaflet_storage_cleanup_log(deleted_at desc);
create index if not exists leaflet_storage_cleanup_log_import_id_idx
  on public.leaflet_storage_cleanup_log(import_id);

alter table public.leaflet_storage_cleanup_log enable row level security;
revoke all on table public.leaflet_storage_cleanup_log from anon, authenticated;
grant select, insert on table public.leaflet_storage_cleanup_log to service_role;

drop function if exists public.get_expired_leaflet_storage_cleanup_candidates(integer, integer);
create function public.get_expired_leaflet_storage_cleanup_candidates(
  p_limit integer default 300,
  p_grace_days integer default 1
)
returns table (
  import_id uuid,
  bucket text,
  path text,
  bytes bigint,
  detected_valid_to date,
  import_status text
)
language sql
security definer
set search_path to 'public', 'storage'
as $function$
  with candidates as (
    select
      li.id as import_id,
      coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') as bucket,
      li.metadata ->> 'storage_path' as path,
      li.detected_valid_to,
      li.status as import_status
    from public.leaflet_imports li
    where li.detected_valid_to is not null
      and li.detected_valid_to < current_date - greatest(coalesce(p_grace_days, 1), 0)
      and coalesce(li.metadata ->> 'storage_path','') <> ''
      and coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') = 'leaflets'
      and coalesce(li.metadata ->> 'storage_deleted_at','') = ''
      and not exists (
        select 1
        from public.leaflet_imports other
        where other.id <> li.id
          and coalesce(nullif(other.metadata ->> 'storage_bucket',''), 'leaflets') = coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets')
          and other.metadata ->> 'storage_path' = li.metadata ->> 'storage_path'
          and (
            other.detected_valid_to is null
            or other.detected_valid_to >= current_date - greatest(coalesce(p_grace_days, 1), 0)
          )
      )
    order by li.detected_valid_to asc, li.created_at asc
    limit least(greatest(coalesce(p_limit,300),1),1000)
  )
  select
    c.import_id,
    c.bucket,
    c.path,
    coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
    c.detected_valid_to,
    c.import_status
  from candidates c
  left join storage.objects o
    on o.bucket_id = c.bucket
   and o.name = c.path
  order by c.detected_valid_to asc, c.path;
$function$;

revoke all on function public.get_expired_leaflet_storage_cleanup_candidates(integer,integer) from public;
grant execute on function public.get_expired_leaflet_storage_cleanup_candidates(integer,integer) to service_role;

drop function if exists public.get_orphan_leaflet_storage_cleanup_candidates(integer, integer);
create function public.get_orphan_leaflet_storage_cleanup_candidates(
  p_limit integer default 150,
  p_min_age_days integer default 7
)
returns table (
  bucket text,
  path text,
  bytes bigint,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public', 'storage'
as $function$
  select
    o.bucket_id as bucket,
    o.name as path,
    coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
    o.created_at
  from storage.objects o
  where o.bucket_id = 'leaflets'
    and o.created_at < now() - make_interval(days => greatest(coalesce(p_min_age_days,7), 2))
    and not exists (
      select 1
      from public.leaflet_imports li
      where coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') = o.bucket_id
        and li.metadata ->> 'storage_path' = o.name
    )
    and not exists (
      select 1
      from public.leaflet_storage_cleanup_log log
      where log.bucket = o.bucket_id
        and log.path = o.name
        and log.cleanup_type = 'orphan'
        and log.status = 'deleted'
    )
  order by o.created_at asc
  limit least(greatest(coalesce(p_limit,150),1),1000);
$function$;

revoke all on function public.get_orphan_leaflet_storage_cleanup_candidates(integer,integer) from public;
grant execute on function public.get_orphan_leaflet_storage_cleanup_candidates(integer,integer) to service_role;

drop function if exists public.finalize_leaflet_storage_cleanup(jsonb);
create function public.finalize_leaflet_storage_cleanup(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item jsonb;
  v_import_id uuid;
  v_bucket text;
  v_path text;
  v_bytes bigint;
  v_finalized integer := 0;
  v_ocr_pages integer := 0;
  v_ocr_runs integer := 0;
  v_text_rows integer := 0;
  v_basic_runs integer := 0;
  v_staging_rows integer := 0;
  v_rows integer;
begin
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
    raise exception 'Cleanup items must be a JSON array.';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_import_id := nullif(item ->> 'import_id','')::uuid;
    v_bucket := coalesce(nullif(item ->> 'bucket',''),'leaflets');
    v_path := nullif(item ->> 'path','');
    v_bytes := greatest(coalesce(nullif(item ->> 'bytes','')::bigint,0),0);

    if v_import_id is null or v_path is null or v_bucket <> 'leaflets' then
      continue;
    end if;

    update public.leaflet_imports li
    set status = case when li.status in ('published','review') then 'ignored' else li.status end,
        metadata = (coalesce(li.metadata,'{}'::jsonb) - 'storage_path') || jsonb_build_object(
          'storage_bucket', v_bucket,
          'archived_storage_path', v_path,
          'storage_deleted_at', now(),
          'storage_deleted_bytes', v_bytes,
          'storage_cleanup_policy', 'expired_leaflet_source_v1',
          'archived_automatically_at', coalesce(li.metadata -> 'archived_automatically_at', to_jsonb(now())),
          'archive_reason', 'expired_storage_cleanup'
        ),
        updated_at = now()
    where li.id = v_import_id
      and li.detected_valid_to is not null
      and li.detected_valid_to < current_date
      and coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') = v_bucket
      and li.metadata ->> 'storage_path' = v_path;

    if found then
      v_finalized := v_finalized + 1;

      delete from public.leaflet_extracted_text where import_id = v_import_id;
      get diagnostics v_rows = row_count;
      v_text_rows := v_text_rows + v_rows;

      delete from public.leaflet_ocr_pages where import_id = v_import_id;
      get diagnostics v_rows = row_count;
      v_ocr_pages := v_ocr_pages + v_rows;

      delete from public.leaflet_ocr_runs where import_id = v_import_id;
      get diagnostics v_rows = row_count;
      v_ocr_runs := v_ocr_runs + v_rows;

      delete from public.leaflet_basic_parser_runs where import_id = v_import_id;
      get diagnostics v_rows = row_count;
      v_basic_runs := v_basic_runs + v_rows;

      delete from public.albert_offer_staging where source_import_id = v_import_id;
      get diagnostics v_rows = row_count;
      v_staging_rows := v_staging_rows + v_rows;

      insert into public.leaflet_storage_cleanup_log(import_id,bucket,path,bytes,cleanup_type,status)
      values(v_import_id,v_bucket,v_path,v_bytes,'expired_import','deleted');
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'finalized_imports', v_finalized,
    'deleted_extracted_text_rows', v_text_rows,
    'deleted_ocr_pages', v_ocr_pages,
    'deleted_ocr_runs', v_ocr_runs,
    'deleted_basic_parser_runs', v_basic_runs,
    'deleted_staging_rows', v_staging_rows
  );
end;
$function$;

revoke all on function public.finalize_leaflet_storage_cleanup(jsonb) from public;
grant execute on function public.finalize_leaflet_storage_cleanup(jsonb) to service_role;

drop function if exists public.log_orphan_leaflet_storage_cleanup(jsonb);
create function public.log_orphan_leaflet_storage_cleanup(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
    raise exception 'Cleanup items must be a JSON array.';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    if coalesce(item ->> 'bucket','') <> 'leaflets' or coalesce(item ->> 'path','') = '' then
      continue;
    end if;
    insert into public.leaflet_storage_cleanup_log(import_id,bucket,path,bytes,cleanup_type,status)
    values(null,item ->> 'bucket',item ->> 'path',greatest(coalesce(nullif(item ->> 'bytes','')::bigint,0),0),'orphan','deleted');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.log_orphan_leaflet_storage_cleanup(jsonb) from public;
grant execute on function public.log_orphan_leaflet_storage_cleanup(jsonb) to service_role;

-- Archive every expired visible leaflet, not only imports with zero products.
create or replace function public.archive_expired_document_leaflet_imports()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  affected integer;
begin
  update public.leaflet_imports
  set status = 'ignored',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_automatically_at', now(),
        'archive_reason', 'document_expired_scheduler'
      ),
      updated_at = now()
  where status in ('published','review')
    and detected_valid_to is not null
    and detected_valid_to < current_date;

  get diagnostics affected = row_count;
  return affected;
end;
$function$;

-- Internal dispatcher for the Edge Function. The cron secret never leaves DB.
create or replace function public.trigger_expired_leaflet_storage_cleanup()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret,'') = '' then
    raise warning 'Vault secret slevao_cron_secret is missing.';
    return null;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/cleanup-expired-leaflet-storage',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := jsonb_build_object('expired_limit',300,'orphan_limit',150,'grace_days',1,'orphan_age_days',7),
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.trigger_expired_leaflet_storage_cleanup() from public;
grant execute on function public.trigger_expired_leaflet_storage_cleanup() to service_role;

-- Schedule one daily physical cleanup. Logical archival continues every 15 min.
do $block$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'slevao-expired-leaflet-storage-cleanup'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'slevao-expired-leaflet-storage-cleanup',
    '35 4 * * *',
    'select public.trigger_expired_leaflet_storage_cleanup();'
  );
end
$block$;
