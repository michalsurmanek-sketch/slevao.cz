alter table public.leaflet_sources
  add column if not exists adapter_key text,
  add column if not exists extraction_strategy text not null default 'auto',
  add column if not exists fallback_order text[] not null default array['feed','api','structured_html','html','pdf','manual']::text[],
  add column if not exists manual_fallback_enabled boolean not null default true,
  add column if not exists last_strategy_used text,
  add column if not exists last_strategy_success_at timestamptz;

create table if not exists public.leaflet_adapter_registry (
  store_slug text primary key,
  adapter_key text not null,
  strategy_order text[] not null,
  manual_fallback_enabled boolean not null default true,
  notes text,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.leaflet_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.leaflet_sources(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  strategy text not null,
  status text not null default 'queued',
  input_url text,
  import_id uuid references public.leaflet_imports(id) on delete set null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint leaflet_pipeline_runs_status_check check (status in ('queued','running','review','completed','failed','skipped')),
  constraint leaflet_pipeline_runs_strategy_check check (strategy in ('feed','api','structured_html','html','pdf','browser','manual'))
);

create index if not exists leaflet_pipeline_runs_source_created_idx on public.leaflet_pipeline_runs(source_id, created_at desc);
create index if not exists leaflet_pipeline_runs_status_created_idx on public.leaflet_pipeline_runs(status, created_at desc);

insert into public.leaflet_adapter_registry(store_slug, adapter_key, strategy_order, manual_fallback_enabled, notes)
values
  ('globus','globus-structured',array['structured_html','html','pdf','manual'],true,'Produkty a ceny primárně ze strukturovaných dat webu.'),
  ('lidl','lidl-api',array['api','structured_html','pdf','manual'],true,'Primárně oficiální API, PDF jen záloha.'),
  ('coop','coop-specialized',array['structured_html','html','pdf','manual'],true,'Regionální specializovaný adaptér.'),
  ('hruska','hruska-specialized',array['structured_html','html','pdf','manual'],true,'Specializovaný adaptér Hruška.'),
  ('tesco','tesco-browser',array['structured_html','browser','manual'],true,'Serverové PDF je blokované; zachovat ruční a browser fallback.'),
  ('penny','penny-viewer',array['structured_html','html','pdf','manual'],true,'PDF získávat z oficiálního vieweru.'),
  ('kaufland','kaufland-structured',array['structured_html','html','pdf','manual'],true,'Preferovat produktová data a oficiální web.'),
  ('billa','billa-html',array['structured_html','html','pdf','manual'],true,'Preferovat strukturované HTML a katalog.'),
  ('albert','albert-html',array['structured_html','html','pdf','manual'],true,'Preferovat strukturované HTML.'),
  ('norma','norma-pdf',array['html','pdf','manual'],true,'PDF bez AI ponechat ke kontrole nebo ručnímu zpracování.'),
  ('makro','makro-viewer',array['structured_html','html','pdf','manual'],true,'Preferovat viewer/strukturovaná data.')
on conflict (store_slug) do update set
  adapter_key=excluded.adapter_key,
  strategy_order=excluded.strategy_order,
  manual_fallback_enabled=excluded.manual_fallback_enabled,
  notes=excluded.notes,
  is_enabled=true,
  updated_at=now();

update public.leaflet_sources ls
set adapter_key = ar.adapter_key,
    fallback_order = ar.strategy_order,
    manual_fallback_enabled = ar.manual_fallback_enabled,
    extraction_strategy = ar.strategy_order[1]
from public.stores s
join public.leaflet_adapter_registry ar on ar.store_slug=s.slug
where ls.store_id=s.id;

create or replace view public.leaflet_source_pipeline_status as
select ls.id as source_id, s.slug as store_slug, s.name as store_name, ls.name as source_name,
  ls.is_active, ls.automation_mode, ls.adapter_key, ls.extraction_strategy, ls.fallback_order,
  ls.manual_fallback_enabled, ls.last_strategy_used, ls.last_strategy_success_at,
  ls.last_checked_at, ls.last_success_at, ls.last_error
from public.leaflet_sources ls join public.stores s on s.id=ls.store_id;

create or replace function public.trigger_leaflet_pipeline_v2(p_store_slug text default null)
returns bigint language plpgsql security definer set search_path=public,extensions,vault as $$
declare cron_secret text; request_id bigint;
begin
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='slevao_cron_secret' order by created_at desc limit 1;
  if coalesce(cron_secret,'')='' then return null; end if;
  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/run-leaflet-pipeline-v2',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret),
    body := case when p_store_slug is null then '{}'::jsonb else jsonb_build_object('store_slug',p_store_slug) end,
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end; $$;

do $$ declare existing_job bigint; begin
  select jobid into existing_job from cron.job where jobname='slevao-leaflet-pipeline-v2' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('slevao-leaflet-pipeline-v2','*/15 * * * *',$cron$select public.trigger_leaflet_pipeline_v2();$cron$);
end $$;