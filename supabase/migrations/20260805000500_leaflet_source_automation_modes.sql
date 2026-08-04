alter table public.leaflet_sources
  add column if not exists automation_mode text not null default 'automatic',
  add column if not exists disabled_reason text,
  add column if not exists next_review_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='leaflet_sources_automation_mode_check'
      and conrelid='public.leaflet_sources'::regclass
  ) then
    alter table public.leaflet_sources
      add constraint leaflet_sources_automation_mode_check
      check (automation_mode in ('automatic','specialized','web_only','blocked','paused'));
  end if;
end;
$$;

update public.leaflet_sources ls
set automation_mode='specialized',
    disabled_reason=null,
    next_review_at=null
from public.stores s
where s.id=ls.store_id and s.slug in ('coop','hruska');

update public.leaflet_sources ls
set is_active=false,
    automation_mode=case
      when s.slug='ikea' then 'web_only'
      when s.slug in ('enapo','moebelix','asko','alza','mountfield') then 'blocked'
      else 'paused'
    end,
    disabled_reason=case
      when s.slug='ikea' then 'Oficiální web nenabízí aktuální PDF katalog; nabídky jsou pouze webové.'
      when s.slug='enapo' then 'Oficiální server vrací neplatný certifikát a nelze jej bezpečně načíst.'
      when s.slug in ('moebelix','asko','alza','mountfield') then 'Oficiální web blokuje serverové načítání HTTP 403.'
      else 'Oficiální adresa letáku vrací HTTP 404 nebo už neexistuje.'
    end,
    next_review_at=now()+interval '30 days',
    last_error=case
      when s.slug='ikea' then 'Pozastaveno: obchod momentálně neposkytuje aktuální PDF leták.'
      when s.slug='enapo' then 'Pozastaveno: neplatný certifikát oficiálního webu.'
      when s.slug in ('moebelix','asko','alza','mountfield') then 'Pozastaveno: oficiální web blokuje automatické načítání.'
      else 'Pozastaveno: oficiální URL letáku neexistuje.'
    end
from public.stores s
where s.id=ls.store_id
  and s.slug in ('ikea','enapo','moebelix','sconto','asko','obi','bauhaus','alza','mountfield');

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
      when new.automation_mode='specialized' then 'specialized'
      else 'automatic'
    end;
    new.disabled_reason := null;
    new.next_review_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reactivate_leaflet_source_after_success on public.leaflet_sources;
create trigger trg_reactivate_leaflet_source_after_success
before update of last_success_at on public.leaflet_sources
for each row execute function public.reactivate_leaflet_source_after_success();

create or replace function public.recheck_paused_leaflet_sources(p_limit integer default 4)
returns integer
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  cron_secret text;
  queued integer:=0;
  candidate record;
begin
  p_limit:=greatest(1,least(coalesce(p_limit,4),10));
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  limit 1;
  if coalesce(cron_secret,'')='' then return 0; end if;

  for candidate in
    select distinct s.slug
    from public.leaflet_sources ls
    join public.stores s on s.id=ls.store_id
    where ls.automation_mode in ('web_only','blocked','paused')
      and coalesce(ls.next_review_at,'epoch'::timestamptz)<=now()
      and s.is_active=true
    order by s.slug
    limit p_limit
  loop
    perform net.http_post(
      url:='https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-official-leaflet-sources',
      headers:=jsonb_build_object('content-type','application/json','x-cron-secret',cron_secret),
      body:=jsonb_build_object('store_slug',candidate.slug,'limit',1,'force',true),
      timeout_milliseconds:=120000
    );
    update public.leaflet_sources ls
    set next_review_at=now()+interval '30 days'
    from public.stores s
    where s.id=ls.store_id and s.slug=candidate.slug;
    queued:=queued+1;
  end loop;
  return queued;
end;
$$;

revoke all on function public.recheck_paused_leaflet_sources(integer) from public;
grant execute on function public.recheck_paused_leaflet_sources(integer) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='recheck-paused-leaflet-sources') then
    perform cron.unschedule('recheck-paused-leaflet-sources');
  end if;
end;
$$;

select cron.schedule(
  'recheck-paused-leaflet-sources',
  '43 4 * * *',
  $job$select public.recheck_paused_leaflet_sources(4);$job$
);

create or replace view public.leaflet_source_health
with (security_invoker=true)
as
select
  ls.id,
  ls.store_id,
  s.slug as store_slug,
  s.name as store_name,
  ls.name as source_name,
  ls.source_url,
  ls.source_type,
  ls.is_active,
  ls.automation_mode,
  ls.disabled_reason,
  ls.check_interval_minutes,
  ls.last_checked_at,
  ls.last_success_at,
  ls.last_error,
  ls.next_review_at,
  case
    when ls.automation_mode in ('blocked','paused','web_only') then ls.automation_mode
    when ls.last_success_at>=now()-interval '24 hours' then 'healthy'
    when ls.last_success_at>=now()-interval '7 days' then 'warning'
    when ls.last_success_at is null then 'never_succeeded'
    else 'stale'
  end as health_status
from public.leaflet_sources ls
left join public.stores s on s.id=ls.store_id;