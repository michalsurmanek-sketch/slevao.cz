-- A resolver must not reactivate a paused/blocked source just because it found any PDF.
-- Reactivation is allowed only when the source already has a non-rejected import in
-- review/published state. This prevents legal notices, recalls and similar documents
-- from turning a broken leaflet source back on.

create or replace function public.reject_non_leaflet_import_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  searchable text;
begin
  searchable := lower(
    coalesce(new.source_document_url,'') || ' ' ||
    coalesce(new.metadata->>'publication_title','') || ' ' ||
    coalesce(new.metadata->>'source_name','')
  );

  if searchable ~ '(vraceni|vrácení|recall|stazeni|stažení|stazeni-z-trhu|stažení-z-trhu|bezpecnostni|bezpečnostní|varovani|varování|upozorneni-spotrebitele|upozornění-spotřebitele|reklamacni-formular|reklamační-formulář|zverejneni[_ -]?fuze|zveřejnění[_ -]?fúze|projekt[_ -]?fuze|projekt[_ -]?fúze|oznameni[_ -]?fuze|oznámení[_ -]?fúze)' then
    new.status := 'ignored';
    new.error_message := null;
    new.finished_at := coalesce(new.finished_at,now());
    new.metadata := jsonb_set(
      jsonb_set(coalesce(new.metadata,'{}'::jsonb),'{rejected_non_leaflet}','true'::jsonb,true),
      '{rejected_reason}',
      to_jsonb('Dokument není akční leták (bezpečnostní, spotřebitelské nebo právní oznámení).'::text),
      true
    );
  end if;

  return new;
end;
$$;

create or replace function public.reactivate_leaflet_source_after_success()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  has_valid_import boolean := false;
begin
  if new.last_success_at is distinct from old.last_success_at
     and new.last_success_at is not null
     and new.last_success_at >= now()-interval '10 minutes' then

    select exists (
      select 1
      from public.leaflet_imports li
      where li.source_id = new.id
        and li.status in ('review','published')
        and coalesce((li.metadata->>'rejected_non_leaflet')::boolean,false) = false
        and (li.detected_valid_to is null or li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date - 1)
    ) into has_valid_import;

    if has_valid_import then
      new.is_active := true;
      new.automation_mode := case
        when new.automation_mode='specialized' then 'specialized'
        else 'automatic'
      end;
      new.disabled_reason := null;
      new.next_review_at := null;
    elsif old.is_active = false then
      -- Preserve a deliberate pause/block until a genuinely usable import exists.
      new.is_active := false;
      new.automation_mode := old.automation_mode;
      new.disabled_reason := old.disabled_reason;
      new.next_review_at := old.next_review_at;
    end if;
  end if;
  return new;
end;
$$;

-- Mark the known Intersport landing pages as paused. The current /akce/ page is a
-- web product sale, while the PDF discovered from it is a merger notice, not a leaflet.
update public.leaflet_sources ls
set is_active = false,
    auto_publish = false,
    automation_mode = 'paused',
    disabled_reason = 'Oficiální stránka obsahuje webové akce; nalezené PDF není akční leták.',
    next_review_at = now() + interval '30 days',
    last_error = null,
    updated_at = now()
from public.stores s
where s.id = ls.store_id
  and s.slug = 'intersport'
  and lower(rtrim(ls.source_url,'/')) in (
    'https://www.intersport.cz/akce',
    'https://www.intersport.cz/letak'
  );

-- Clean/reject the already discovered merger document as well.
update public.leaflet_imports
set status = 'ignored',
    error_message = null,
    finished_at = coalesce(finished_at,now()),
    metadata = jsonb_set(
      jsonb_set(coalesce(metadata,'{}'::jsonb),'{rejected_non_leaflet}','true'::jsonb,true),
      '{rejected_reason}',
      to_jsonb('Právní oznámení o fúzi není akční leták.'::text),
      true
    )
where lower(coalesce(source_document_url,'')) ~ '(zverejneni[_ -]?fuze|zveřejnění[_ -]?fúze|projekt[_ -]?fuze|projekt[_ -]?fúze|oznameni[_ -]?fuze|oznámení[_ -]?fúze)';
