create or replace function public.propagate_leaflet_item_confidence_to_offer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.leaflet_imports%rowtype;
begin
  if new.status <> 'published'
     or new.confidence is null
     or new.price is null then
    return new;
  end if;

  select * into v_job
  from public.leaflet_imports
  where id = new.import_id;

  if not found
     or v_job.detected_valid_from is null
     or v_job.detected_valid_to is null then
    return new;
  end if;

  update public.offers o
  set confidence_score = greatest(0, least(1, new.confidence)),
      is_verified = new.confidence >= 0.90,
      updated_at = now()
  where o.store_id = v_job.store_id
    and o.title = new.title
    and o.price = new.price
    and o.valid_from = v_job.detected_valid_from
    and o.valid_to = v_job.detected_valid_to
    and o.coverage_scope = coalesce(v_job.coverage_scope, 'national')
    and o.region_code is not distinct from v_job.region_code
    and o.city_name is not distinct from v_job.city_name
    and o.store_location_name is not distinct from v_job.store_location_name
    and o.status = 'published';

  return new;
end;
$$;

with published_items as (
  select lii.title,
         lii.price,
         lii.confidence,
         li.store_id,
         li.detected_valid_from,
         li.detected_valid_to,
         coalesce(li.coverage_scope, 'national') as coverage_scope,
         li.region_code,
         li.city_name,
         li.store_location_name
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id = lii.import_id
  where lii.status = 'published'
    and lii.confidence is not null
    and lii.price is not null
    and li.detected_valid_from is not null
    and li.detected_valid_to is not null
)
update public.offers o
set confidence_score = greatest(0, least(1, p.confidence)),
    is_verified = p.confidence >= 0.90,
    updated_at = now()
from published_items p
where o.store_id = p.store_id
  and o.title = p.title
  and o.price = p.price
  and o.valid_from = p.detected_valid_from
  and o.valid_to = p.detected_valid_to
  and o.coverage_scope = p.coverage_scope
  and o.region_code is not distinct from p.region_code
  and o.city_name is not distinct from p.city_name
  and o.store_location_name is not distinct from p.store_location_name
  and o.status = 'published';
