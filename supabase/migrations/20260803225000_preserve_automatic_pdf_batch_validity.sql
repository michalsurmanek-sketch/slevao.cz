create or replace function public.preserve_automatic_pdf_batch_validity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata_from text;
  metadata_to text;
begin
  if not coalesce((new.metadata->>'automatic_pdf_split')::boolean, false) then
    return new;
  end if;

  metadata_from := nullif(new.metadata->>'batch_valid_from', '');
  metadata_to := nullif(new.metadata->>'batch_valid_to', '');

  if new.detected_valid_from is null
     and metadata_from ~ '^\d{4}-\d{2}-\d{2}$' then
    new.detected_valid_from := metadata_from::date;
  end if;

  if new.detected_valid_to is null
     and metadata_to ~ '^\d{4}-\d{2}-\d{2}$' then
    new.detected_valid_to := metadata_to::date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_automatic_pdf_batch_validity on public.leaflet_imports;
create trigger trg_preserve_automatic_pdf_batch_validity
before insert or update of detected_valid_from, detected_valid_to, metadata
on public.leaflet_imports
for each row
execute function public.preserve_automatic_pdf_batch_validity();
