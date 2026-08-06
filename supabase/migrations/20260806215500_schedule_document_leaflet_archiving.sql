create or replace function public.archive_expired_document_leaflet_imports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.leaflet_imports
  set status = 'ignored',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_automatically_at', now(),
        'archive_reason', 'document_expired_scheduler'
      )
  where status = 'published'
    and coalesce(product_count, 0) = 0
    and detected_valid_to is not null
    and detected_valid_to < current_date;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'slevao-archive-expired-document-leaflets'
  ) then
    perform cron.schedule(
      'slevao-archive-expired-document-leaflets',
      '*/15 * * * *',
      'select public.archive_expired_document_leaflet_imports();'
    );
  end if;
end;
$$;

select public.archive_expired_document_leaflet_imports();
