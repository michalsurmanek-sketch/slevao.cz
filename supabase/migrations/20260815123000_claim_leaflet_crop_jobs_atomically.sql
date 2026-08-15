-- Atomically claim one crop import so duplicate cron/trigger deliveries cannot
-- process and publish the same page at the same time.
create or replace function public.claim_leaflet_crop_import(p_import_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_metadata jsonb;
begin
  update public.leaflet_imports l
  set metadata = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(l.metadata, '{}'::jsonb), '{crop_status}', '"running"'::jsonb, true),
        '{crop_run_id}', to_jsonb(p_run_id::text), true
      ),
      '{crop_started_at}', to_jsonb(now()), true
    ),
    '{crop_attempt_count}',
    to_jsonb(coalesce((l.metadata->>'crop_attempt_count')::integer, 0) + 1),
    true
  )
  where l.id = p_import_id
    and l.status in ('review', 'published')
    and (
      coalesce(l.metadata->>'crop_status', '') in ('', 'queued')
      or (
        l.metadata->>'crop_status' = 'running'
        and coalesce((l.metadata->>'crop_started_at')::timestamptz, 'epoch') < now() - interval '15 minutes'
      )
      or (
        l.metadata->>'crop_status' = 'failed'
        and coalesce((l.metadata->>'crop_finished_at')::timestamptz, 'epoch') < now() - interval '6 hours'
      )
      or (
        l.metadata->>'crop_status' = 'blocked_dependency'
        and coalesce((l.metadata->>'crop_next_retry_at')::timestamptz, now()) <= now()
      )
    )
  returning l.metadata into claimed_metadata;

  return claimed_metadata;
end;
$$;

revoke all on function public.claim_leaflet_crop_import(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_leaflet_crop_import(uuid, uuid) to service_role;
