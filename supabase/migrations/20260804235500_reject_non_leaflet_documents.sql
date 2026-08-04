create or replace function public.reject_non_leaflet_source_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  searchable text;
begin
  searchable := lower(coalesce(new.name,'') || ' ' || coalesce(new.source_url,''));

  if searchable ~ '(vraceni|vrácení|recall|stazeni|stažení|stazeni-z-trhu|stažení-z-trhu|bezpecnostni|bezpečnostní|varovani|varování|upozorneni-spotrebitele|upozornění-spotřebitele|reklamacni-formular|reklamační-formulář)' then
    new.is_active := false;
    new.auto_publish := false;
    new.last_error := 'Dokument byl automaticky vyřazen: nejde o akční leták, ale o bezpečnostní nebo spotřebitelské oznámení.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_non_leaflet_source_document on public.leaflet_sources;
create trigger trg_reject_non_leaflet_source_document
before insert or update of name,source_url,is_active on public.leaflet_sources
for each row execute function public.reject_non_leaflet_source_document();

create or replace function public.reject_non_leaflet_import_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  searchable text;
begin
  searchable := lower(coalesce(new.source_document_url,'') || ' ' || coalesce(new.metadata->>'publication_title','') || ' ' || coalesce(new.metadata->>'source_name',''));

  if searchable ~ '(vraceni|vrácení|recall|stazeni|stažení|stazeni-z-trhu|stažení-z-trhu|bezpecnostni|bezpečnostní|varovani|varování|upozorneni-spotrebitele|upozornění-spotřebitele|reklamacni-formular|reklamační-formulář)' then
    new.status := 'ignored';
    new.error_message := null;
    new.finished_at := coalesce(new.finished_at,now());
    new.metadata := jsonb_set(
      jsonb_set(coalesce(new.metadata,'{}'::jsonb),'{rejected_non_leaflet}','true'::jsonb,true),
      '{rejected_reason}',
      to_jsonb('Bezpečnostní nebo spotřebitelské oznámení není akční leták.'::text),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_non_leaflet_import_document on public.leaflet_imports;
create trigger trg_reject_non_leaflet_import_document
before insert or update of source_document_url,metadata,status on public.leaflet_imports
for each row execute function public.reject_non_leaflet_import_document();

update public.leaflet_sources
set is_active=false,
    auto_publish=false,
    last_error='Dokument byl automaticky vyřazen: nejde o akční leták, ale o bezpečnostní nebo spotřebitelské oznámení.'
where lower(coalesce(name,'') || ' ' || coalesce(source_url,''))
  ~ '(vraceni|vrácení|recall|stazeni|stažení|stazeni-z-trhu|stažení-z-trhu|bezpecnostni|bezpečnostní|varovani|varování|upozorneni-spotrebitele|upozornění-spotřebitele|reklamacni-formular|reklamační-formulář)';

update public.leaflet_imports
set status='ignored',
    error_message=null,
    finished_at=coalesce(finished_at,now()),
    metadata=jsonb_set(
      jsonb_set(coalesce(metadata,'{}'::jsonb),'{rejected_non_leaflet}','true'::jsonb,true),
      '{rejected_reason}',
      to_jsonb('Bezpečnostní nebo spotřebitelské oznámení není akční leták.'::text),
      true
    )
where lower(coalesce(source_document_url,'') || ' ' || coalesce(metadata->>'publication_title','') || ' ' || coalesce(metadata->>'source_name',''))
  ~ '(vraceni|vrácení|recall|stazeni|stažení|stazeni-z-trhu|stažení-z-trhu|bezpecnostni|bezpečnostní|varovani|varování|upozorneni-spotrebitele|upozornění-spotřebitele|reklamacni-formular|reklamační-formulář)';