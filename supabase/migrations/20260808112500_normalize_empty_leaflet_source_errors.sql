-- Several discovery adapters can serialize an empty Error-like object as
-- {"message":""}. It is not a failure, but health checks treat any non-empty
-- last_error text as unhealthy. Normalize these values at the database boundary.

create or replace function public.normalize_leaflet_source_last_error()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.last_error is not null
     and btrim(new.last_error) in ('', '{}', '{"message":""}', '{"message":null}') then
    new.last_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_leaflet_source_last_error on public.leaflet_sources;
create trigger trg_normalize_leaflet_source_last_error
before insert or update of last_error on public.leaflet_sources
for each row execute function public.normalize_leaflet_source_last_error();

update public.leaflet_sources
set last_error = null
where last_error is not null
  and btrim(last_error) in ('', '{}', '{"message":""}', '{"message":null}');
