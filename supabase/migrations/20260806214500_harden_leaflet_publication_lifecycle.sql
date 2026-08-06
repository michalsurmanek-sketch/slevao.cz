create or replace function public.guard_leaflet_import_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.source_hash is not null and new.source_hash is distinct from old.source_hash then
    raise exception 'Identitu existujícího importu nelze změnit (source_hash).';
  end if;

  if old.store_id is not null and new.store_id is distinct from old.store_id then
    raise exception 'Existující import nelze přesunout k jinému obchodu.';
  end if;

  if old.source_id is not null and new.source_id is distinct from old.source_id then
    raise exception 'Existující import nelze přesunout k jinému zdroji.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_leaflet_import_identity on public.leaflet_imports;
create trigger trg_guard_leaflet_import_identity
before update of source_hash, store_id, source_id on public.leaflet_imports
for each row execute function public.guard_leaflet_import_identity();

create or replace function public.normalize_expired_document_leaflet_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.product_count, 0) = 0
     and new.status = 'published'
     and new.detected_valid_to is not null
     and new.detected_valid_to < current_date then
    new.status := 'ignored';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'archived_automatically_at', now(),
      'archive_reason', 'document_expired'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_expired_document_leaflet_status on public.leaflet_imports;
create trigger trg_normalize_expired_document_leaflet_status
before insert or update of status, product_count, detected_valid_to, metadata
on public.leaflet_imports
for each row execute function public.normalize_expired_document_leaflet_status();

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
       'kik-publitas-v1',
       'obi-bonial-v1'
     )
     and new.status in ('review', 'published') then
    new.status := 'published';
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  return new;
end;
$$;

create index if not exists leaflet_imports_current_source_idx
on public.leaflet_imports (source_id, status, detected_valid_to desc, created_at desc)
where status in ('published', 'review', 'processing', 'queued', 'downloading', 'publishing');

update public.leaflet_imports
set status = 'ignored',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'archived_automatically_at', now(),
      'archive_reason', 'document_expired_migration'
    )
where status = 'published'
  and coalesce(product_count, 0) = 0
  and detected_valid_to is not null
  and detected_valid_to < current_date;
