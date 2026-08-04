create or replace function public.start_leaflet_product_crops_after_status()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  cron_secret text;
  is_image boolean;
begin
  if new.status not in ('review','published')
     or new.status is not distinct from old.status then
    return new;
  end if;

  is_image := coalesce(new.metadata->>'content_type','') like 'image/%'
    or new.source_document_url ~* '\.(?:webp|png|jpe?g)(?:\?.*)?$';
  if not is_image then
    return new;
  end if;

  if new.status = 'review'
     and coalesce(new.metadata->>'crop_status','') = 'completed' then
    return new;
  end if;

  if new.status = 'published'
     and coalesce((new.metadata->>'crop_attached_count')::integer,0) > 0 then
    return new;
  end if;

  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'slevao_cron_secret'
  limit 1;

  if cron_secret is null or cron_secret = '' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/generate-leaflet-product-crops',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',cron_secret
    ),
    body := jsonb_build_object('import_id',new.id),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_start_leaflet_product_crops_after_status on public.leaflet_imports;
create trigger trg_start_leaflet_product_crops_after_status
after update of status on public.leaflet_imports
for each row
execute function public.start_leaflet_product_crops_after_status();