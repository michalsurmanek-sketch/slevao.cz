-- OBI now extracts structured product rows from the official PDF.
-- Do not auto-finish it as a document-only leaflet before those rows are published.

create or replace function public.normalize_verified_document_leaflet_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.product_count, 0) = 0
     and new.error_message is null
     and coalesce(new.metadata ->> 'adapter', '') in (
       'albert-publitas-v1',
       'bauhaus-ipaper-v1',
       'drmax-triobo-v1',
       'jip-flip-pdf-v1',
       'jysk-ipaper-v1',
       'kaufland-pdf-v1',
       'kik-publitas-v1'
     )
     and new.status in ('review', 'published') then
    new.status := 'published';
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  return new;
end;
$$;

update public.leaflet_imports li
set status = 'publishing',
    error_message = null,
    finished_at = null,
    updated_at = now(),
    metadata = coalesce(li.metadata, '{}'::jsonb) || jsonb_build_object(
      'publication_requeued_at', now(),
      'publication_requeue_reason', 'obi_products_were_blocked_by_document_only_status'
    )
where coalesce(li.metadata ->> 'adapter', '') = 'obi-bonial-v1'
  and li.detected_valid_to >= current_date
  and exists (
    select 1
    from public.leaflet_import_items item
    where item.import_id = li.id
      and item.status in ('review', 'approved')
  );