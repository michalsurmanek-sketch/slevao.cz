-- Slevao.cz: pravidelná kontrola letáků a úklid skončených nabídek.
-- Platnost valid_to je včetně daného dne. Nabídka se odstraní až následující den.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.expired_offer_archive (
  original_offer_id uuid primary key,
  valid_to date not null,
  offer_snapshot jsonb not null,
  archived_at timestamptz not null default now()
);

alter table public.expired_offer_archive enable row level security;

drop policy if exists "staff read expired offers" on public.expired_offer_archive;
create policy "staff read expired offers"
  on public.expired_offer_archive
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'editor'));

create or replace function public.archive_and_delete_expired_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  insert into public.expired_offer_archive (
    original_offer_id,
    valid_to,
    offer_snapshot,
    archived_at
  )
  select
    o.id,
    o.valid_to,
    to_jsonb(o),
    now()
  from public.offers o
  where o.valid_to < current_date
  on conflict (original_offer_id) do update set
    valid_to = excluded.valid_to,
    offer_snapshot = excluded.offer_snapshot,
    archived_at = excluded.archived_at;

  delete from public.offers o
  using public.expired_offer_archive a
  where o.id = a.original_offer_id
    and o.valid_to < current_date;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.archive_and_delete_expired_offers() from public;
grant execute on function public.archive_and_delete_expired_offers() to service_role;

-- Volání Edge Function používá CRON_SECRET uložený v Supabase Vault.
-- Funkce bezpečně nic neudělá, dokud tajemství slevao_cron_secret neexistuje.
create or replace function public.trigger_leaflet_discovery()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret, '') = '' then
    raise warning 'Vault secret slevao_cron_secret is missing; leaflet discovery was skipped.';
    return null;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/discover-leaflets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function public.trigger_leaflet_discovery() from public;
grant execute on function public.trigger_leaflet_discovery() to service_role;

-- Migrace je opakovatelná: starší job se stejným názvem nejprve odstraní.
do $$
declare
  job record;
begin
  for job in
    select jobid
    from cron.job
    where jobname in ('slevao-expire-offers', 'slevao-discover-leaflets')
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$$;

-- Prošlé nabídky uklidí nejpozději do 15 minut.
select cron.schedule(
  'slevao-expire-offers',
  '*/15 * * * *',
  'select public.archive_and_delete_expired_offers();'
);

-- Aktivní zdroje letáků zkontroluje každé tři hodiny.
select cron.schedule(
  'slevao-discover-leaflets',
  '7 */3 * * *',
  'select public.trigger_leaflet_discovery();'
);

-- Uklidí také nabídky, které byly prošlé už při nasazení migrace.
select public.archive_and_delete_expired_offers();
