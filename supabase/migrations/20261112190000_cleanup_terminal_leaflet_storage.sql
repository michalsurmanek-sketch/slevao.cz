-- Reclaim old source files for imports that have been terminal for at least 90 days
-- and have no detected validity end date. Preserve import, OCR, and offer records.
alter table public.leaflet_storage_cleanup_log
  drop constraint if exists leaflet_storage_cleanup_log_cleanup_type_check;
alter table public.leaflet_storage_cleanup_log
  add constraint leaflet_storage_cleanup_log_cleanup_type_check
  check (cleanup_type in ('expired_import','orphan','terminal_import'));

create or replace function public.get_terminal_leaflet_storage_cleanup_candidates(
  p_limit integer default 300,
  p_min_age_days integer default 90
)
returns table (
  import_id uuid,
  bucket text,
  path text,
  bytes bigint,
  import_status text,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public', 'storage'
as $function$
  select
    li.id as import_id,
    coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') as bucket,
    li.metadata ->> 'storage_path' as path,
    coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
    li.status as import_status,
    li.created_at
  from public.leaflet_imports li
  left join storage.objects o
    on o.bucket_id = coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets')
   and o.name = li.metadata ->> 'storage_path'
  where li.detected_valid_to is null
    and li.status in ('ignored','failed')
    and li.created_at < now() - make_interval(days => greatest(coalesce(p_min_age_days,90),90))
    and coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') = 'leaflets'
    and coalesce(li.metadata ->> 'storage_path','') <> ''
    and coalesce(li.metadata ->> 'storage_deleted_at','') = ''
    and o.name is not null
    and not exists (
      select 1
      from public.leaflet_imports other
      where other.id <> li.id
        and coalesce(nullif(other.metadata ->> 'storage_bucket',''), 'leaflets') = coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets')
        and other.metadata ->> 'storage_path' = li.metadata ->> 'storage_path'
    )
    and not exists (
      select 1
      from public.leaflet_storage_cleanup_log log
      where log.bucket = coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets')
        and log.path = li.metadata ->> 'storage_path'
        and log.cleanup_type = 'terminal_import'
        and log.status = 'deleted'
    )
  order by li.created_at asc
  limit least(greatest(coalesce(p_limit,300),1),1000);
$function$;

revoke all on function public.get_terminal_leaflet_storage_cleanup_candidates(integer,integer) from public;
grant execute on function public.get_terminal_leaflet_storage_cleanup_candidates(integer,integer) to service_role;

create or replace function public.finalize_terminal_leaflet_storage_cleanup(p_items jsonb)
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
    set metadata = (coalesce(li.metadata,'{}'::jsonb) - 'storage_path') || jsonb_build_object(
          'storage_bucket', v_bucket,
          'archived_storage_path', v_path,
          'storage_deleted_at', now(),
          'storage_deleted_bytes', v_bytes,
          'storage_cleanup_policy', 'terminal_leaflet_source_90d_v1'
        ),
        updated_at = now()
    where li.id = v_import_id
      and li.detected_valid_to is null
      and li.status in ('ignored','failed')
      and li.created_at < now() - interval '90 days'
      and coalesce(nullif(li.metadata ->> 'storage_bucket',''), 'leaflets') = v_bucket
      and li.metadata ->> 'storage_path' = v_path
      and not exists (
        select 1
        from public.leaflet_imports other
        where other.id <> li.id
          and coalesce(nullif(other.metadata ->> 'storage_bucket',''), 'leaflets') = v_bucket
          and other.metadata ->> 'storage_path' = v_path
      );

    if found then
      insert into public.leaflet_storage_cleanup_log(import_id,bucket,path,bytes,cleanup_type,status)
      values(v_import_id,v_bucket,v_path,v_bytes,'terminal_import','deleted');
      v_finalized := v_finalized + 1;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'finalized_imports',v_finalized);
end;
$function$;

revoke all on function public.finalize_terminal_leaflet_storage_cleanup(jsonb) from public;
grant execute on function public.finalize_terminal_leaflet_storage_cleanup(jsonb) to service_role;
