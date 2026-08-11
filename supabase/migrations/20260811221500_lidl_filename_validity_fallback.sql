-- Lidl's official API provides PDF filenames with the exact leaflet period.
-- Use that deterministic source as a fallback so discovery does not depend on
-- AI credits merely to learn validity dates.

create or replace function public.infer_lidl_leaflet_validity_from_url(p_url text)
returns daterange
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  m text[];
  d1 integer;
  m1 integer;
  d2 integer;
  m2 integer;
  y2 integer;
  y1 integer;
  v_from date;
  v_to date;
begin
  m := regexp_match(
    coalesce(p_url,''),
    'Akcni-letak-OD-(?:PONDELI|CTVRTKA)-([0-9]{1,2})-([0-9]{1,2})-([0-9]{1,2})-([0-9]{1,2})-([0-9]{4})-[0-9]{2}\.pdf',
    'i'
  );
  if m is null then return null; end if;

  d1 := m[1]::integer;
  m1 := m[2]::integer;
  d2 := m[3]::integer;
  m2 := m[4]::integer;
  y2 := m[5]::integer;
  y1 := case when m1 > m2 then y2 - 1 else y2 end;

  begin
    v_from := make_date(y1,m1,d1);
    v_to := make_date(y2,m2,d2);
  exception when others then
    return null;
  end;

  if v_from > v_to or v_to - v_from > 14 then return null; end if;
  return daterange(v_from,v_to,'[]');
end;
$function$;

create or replace function public.apply_lidl_filename_validity()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  r daterange;
begin
  if coalesce(new.metadata ->> 'adapter','') = 'store:lidl-api'
     and (new.detected_valid_from is null or new.detected_valid_to is null)
     and coalesce(new.source_document_url,'') <> '' then
    r := public.infer_lidl_leaflet_validity_from_url(new.source_document_url);
    if r is not null then
      new.detected_valid_from := lower(r);
      new.detected_valid_to := upper(r) - 1;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'validity_source','official_lidl_filename',
        'validity_confidence',0.99,
        'validity_inferred_at',now()
      );
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_apply_lidl_filename_validity on public.leaflet_imports;
create trigger trg_apply_lidl_filename_validity
before insert or update of source_document_url,metadata,detected_valid_from,detected_valid_to
on public.leaflet_imports
for each row execute function public.apply_lidl_filename_validity();

-- Repair already discovered Lidl imports that were left without dates after an
-- AI-credit fallback. The source URL itself is the authority for this field.
with parsed as (
  select li.id,public.infer_lidl_leaflet_validity_from_url(li.source_document_url) as r
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id
  where s.slug='lidl'
    and li.metadata ->> 'adapter'='store:lidl-api'
    and (li.detected_valid_from is null or li.detected_valid_to is null)
)
update public.leaflet_imports li
set detected_valid_from=lower(p.r),
    detected_valid_to=upper(p.r)-1,
    metadata=coalesce(li.metadata,'{}'::jsonb)||jsonb_build_object(
      'validity_source','official_lidl_filename',
      'validity_confidence',0.99,
      'validity_inferred_at',now()
    ),
    updated_at=now()
from parsed p
where li.id=p.id and p.r is not null;
