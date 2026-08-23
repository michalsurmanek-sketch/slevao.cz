alter table public.leaflet_sources
  drop constraint if exists leaflet_sources_automation_mode_check;

alter table public.leaflet_sources
  add constraint leaflet_sources_automation_mode_check
  check (automation_mode in ('automatic','specialized','dedicated','web_only','blocked','paused'));

update public.leaflet_sources ls
set automation_mode = 'specialized',
    disabled_reason = null,
    next_review_at = null,
    updated_at = now()
from public.stores s
where s.id = ls.store_id
  and s.slug in (
    'action','albert','bauhaus','benu','coop','dm','dr-max','hruska','jip','jysk',
    'kaufland','kik','obi','pepco','rossmann','terno','teta'
  );

update public.leaflet_sources ls
set automation_mode = 'dedicated',
    disabled_reason = null,
    next_review_at = null,
    updated_at = now()
from public.stores s
where s.id = ls.store_id
  and s.slug in ('tesco','norma');

create or replace function public.reactivate_leaflet_source_after_success()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.last_success_at is distinct from old.last_success_at
     and new.last_success_at is not null
     and new.last_success_at >= now()-interval '10 minutes' then
    new.is_active := true;
    new.automation_mode := case
      when new.automation_mode in ('specialized','dedicated') then new.automation_mode
      else 'automatic'
    end;
    new.disabled_reason := null;
    new.next_review_at := null;
  end if;
  return new;
end;
$$;

create or replace view public.leaflet_source_pipeline_status
with (security_invoker=true)
as
select
  ls.id as source_id,
  s.slug as store_slug,
  s.name as store_name,
  ls.name as source_name,
  (ls.is_active and ls.automation_mode in ('automatic','specialized')) as is_active,
  ls.automation_mode,
  ls.adapter_key,
  ls.extraction_strategy,
  ls.fallback_order,
  ls.manual_fallback_enabled,
  ls.last_strategy_used,
  ls.last_strategy_success_at,
  ls.last_checked_at,
  ls.last_success_at,
  ls.last_error,
  ls.store_id
from public.leaflet_sources ls
join public.stores s on s.id = ls.store_id;

revoke all on table public.leaflet_source_pipeline_status from anon;
grant select on table public.leaflet_source_pipeline_status to authenticated;
