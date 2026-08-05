do $$
begin
  if exists (select 1 from cron.job where jobname='leaflet-crop-backfill') then
    perform cron.unschedule('leaflet-crop-backfill');
  end if;
end;
$$;

drop trigger if exists trg_start_leaflet_product_crops_after_status on public.leaflet_imports;

create or replace function public.reject_public_leaflet_crop_image()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if coalesce(new.image_url,'') ~* '(wsrv\.nl/.*leaflet-pages|/leaflet-pages/|/leaflet-crops/)' then
    new.image_url := null;
  end if;
  return new;
end;
$$;

drop trigger if exists zzz_reject_leaflet_crop_offer on public.offers;
create trigger zzz_reject_leaflet_crop_offer
before insert or update of image_url on public.offers
for each row execute function public.reject_public_leaflet_crop_image();

drop trigger if exists zzz_reject_leaflet_crop_item on public.leaflet_import_items;
create trigger zzz_reject_leaflet_crop_item
before insert or update of image_url on public.leaflet_import_items
for each row execute function public.reject_public_leaflet_crop_image();

drop trigger if exists zzz_reject_leaflet_crop_product on public.products;
create trigger zzz_reject_leaflet_crop_product
before insert or update of image_url on public.products
for each row execute function public.reject_public_leaflet_crop_image();

update public.products
set image_url=null,
    image_source=null,
    image_quality=0,
    image_verified=false
where coalesce(image_url,'') ~* '(wsrv\.nl/.*leaflet-pages|/leaflet-pages/|/leaflet-crops/)';

update public.offers o
set image_url=(
  select case
    when p.image_verified=true
      and coalesce(p.image_quality,0)>=70
      and coalesce(p.image_url,'') !~* '(wsrv\.nl/.*leaflet-pages|/leaflet-pages/|/leaflet-crops/)'
    then p.image_url
    else null
  end
  from public.products p
  where p.id=o.product_id
)
where coalesce(o.image_url,'') ~* '(wsrv\.nl/.*leaflet-pages|/leaflet-pages/|/leaflet-crops/)';

update public.leaflet_import_items i
set image_url=(
  select case
    when p.image_verified=true
      and coalesce(p.image_quality,0)>=70
      and coalesce(p.image_url,'') !~* '(wsrv\.nl/.*leaflet-pages|/leaflet-pages/|/leaflet-crops/)'
    then p.image_url
    else null
  end
  from public.products p
  where p.id=i.product_id
)
where coalesce(i.image_url,'') ~* '(wsrv\.nl/.*leaflet-pages|/leaflet-pages/|/leaflet-crops/)';

update public.leaflet_imports
set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{leaflet_crop_publication_disabled}','true'::jsonb,true)
where coalesce(metadata->>'crop_status','') in ('running','completed');