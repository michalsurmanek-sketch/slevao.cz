create or replace function public.protect_kik_product_import_validity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.metadata->>'adapter' = 'kik-publitas-text-v1'
     and new.metadata ? 'expired_by_source_at'
     and new.detected_valid_to is distinct from old.detected_valid_to then
    new.detected_valid_to := old.detected_valid_to;
    new.metadata := new.metadata - 'expired_by_source_at';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_kik_product_import_validity on public.leaflet_imports;
create trigger trg_protect_kik_product_import_validity
before update on public.leaflet_imports
for each row
execute function public.protect_kik_product_import_validity();

update public.leaflet_imports li
set detected_valid_to = src.max_valid_to,
    metadata = li.metadata - 'expired_by_source_at',
    updated_at = now()
from (
  select li2.id as import_id, max(o.valid_to) as max_valid_to
  from public.leaflet_imports li2
  join public.stores s on s.id = li2.store_id and s.slug = 'kik'
  join public.offers o on o.store_id = s.id
    and o.metadata->>'adapter' = 'kik-publitas-text-v1'
  where li2.metadata->>'adapter' = 'kik-publitas-text-v1'
  group by li2.id
) src
where li.id = src.import_id
  and src.max_valid_to is not null
  and li.detected_valid_to is distinct from src.max_valid_to;