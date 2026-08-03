create or replace function public.route_kaufland_pdf_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((new.metadata->>'automatic_pdf_split')::boolean, false) then
    return new;
  end if;

  if new.source_id is not null
     and new.metadata->>'adapter' = 'store:kaufland'
     and new.source_document_url ~* '^https://.*\.pdf(?:\?.*)?$' then
    new.status := 'ignored';
    new.error_message := null;
    new.metadata := jsonb_set(
      jsonb_set(coalesce(new.metadata, '{}'::jsonb), '{automatic_processor_required}', 'true'::jsonb, true),
      '{automatic_processor}',
      '"process-automatic-pdf-v2"'::jsonb,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_route_kaufland_pdf_before_insert on public.leaflet_imports;
create trigger trg_route_kaufland_pdf_before_insert
before insert on public.leaflet_imports
for each row
execute function public.route_kaufland_pdf_before_insert();

create or replace function public.start_routed_kaufland_pdf_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  cron_secret text;
begin
  if not coalesce((new.metadata->>'automatic_processor_required')::boolean, false) then
    return new;
  end if;

  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if cron_secret is null or cron_secret = '' then
    update public.leaflet_imports
    set status = 'failed',
        error_message = 'Chybí serverové tajemství pro automatické zpracování Kauflandu.',
        finished_at = now()
    where id = new.id;
    return new;
  end if;

  perform net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/process-automatic-pdf-v2',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('import_id', new.id)
  );

  return new;
end;
$$;

drop trigger if exists trg_start_routed_kaufland_pdf_after_insert on public.leaflet_imports;
create trigger trg_start_routed_kaufland_pdf_after_insert
after insert on public.leaflet_imports
for each row
execute function public.start_routed_kaufland_pdf_after_insert();
