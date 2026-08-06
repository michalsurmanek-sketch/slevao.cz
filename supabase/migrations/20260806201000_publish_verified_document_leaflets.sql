-- Ověřené celé letáky (PDF / iPaper) nemají produktové řádky ke schválení.
-- Jejich stav proto normalizujeme přímo na published, zatímco produktové
-- importy se dál schvalují přes stav review.

create or replace function public.normalize_verified_document_leaflet_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.product_count, 0) = 0
     and new.error_message is null
     and coalesce(new.metadata ->> 'adapter', '') in (
       'obi-bonial-v1',
       'jysk-ipaper-v1',
       'bauhaus-ipaper-v1'
     )
     and new.status in ('review', 'published') then
    new.status := 'published';
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_verified_document_leaflet_status
  on public.leaflet_imports;

create trigger trg_normalize_verified_document_leaflet_status
before insert or update of status, product_count, error_message, metadata
on public.leaflet_imports
for each row
execute function public.normalize_verified_document_leaflet_status();

update public.leaflet_imports
set
  status = 'published',
  finished_at = coalesce(finished_at, now()),
  updated_at = now()
where status = 'review'
  and coalesce(product_count, 0) = 0
  and error_message is null
  and coalesce(metadata ->> 'adapter', '') in (
    'obi-bonial-v1',
    'jysk-ipaper-v1',
    'bauhaus-ipaper-v1'
  );
