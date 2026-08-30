create or replace function private.enforce_dedicated_leaflet_source_ownership_mode()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_slug text;
begin
  select s.slug into v_slug
  from public.stores s
  where s.id=new.store_id;

  if v_slug in ('globus','hm','intersport','kosik','makro','pilulka','pro-doma','tedi','zabka') then
    new.automation_mode := 'specialized';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_dedicated_leaflet_source_ownership_mode() from public;

update public.leaflet_sources ls
set automation_mode='specialized', updated_at=now()
from public.stores s
where s.id=ls.store_id
  and s.slug in ('globus','hm','intersport','kosik','makro','pilulka','pro-doma','tedi','zabka')
  and ls.automation_mode is distinct from 'specialized';

drop trigger if exists trg_enforce_dedicated_leaflet_source_ownership_mode on public.leaflet_sources;
create trigger trg_enforce_dedicated_leaflet_source_ownership_mode
before insert or update of store_id, automation_mode
on public.leaflet_sources
for each row
execute function private.enforce_dedicated_leaflet_source_ownership_mode();
