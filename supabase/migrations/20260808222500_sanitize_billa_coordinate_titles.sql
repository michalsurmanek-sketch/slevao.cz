create or replace function public.sanitize_billa_coordinate_title(p_title text)
returns text
language plpgsql
immutable
as $$
declare
  v_title text := regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g');
begin
  v_title := btrim(v_title);
  v_title := regexp_replace(v_title, '^\s*(NAVÍC|NOVINKA|IDEÁLNÍ)\s+', '', 'i');
  v_title := regexp_replace(v_title, '\s+NA\s+STEAKY\s+', ' ', 'i');
  v_title := regexp_replace(v_title, '\bfoto\.\s*', '', 'i');
  v_title := regexp_replace(v_title, '\s*\|\s*$', '', 'g');
  return btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
end;
$$;

create or replace function public.sanitize_billa_coordinate_item_title()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.raw_data->>'parser', '') = 'billa-coordinate-v1' then
    new.title := public.sanitize_billa_coordinate_title(new.title);
    if length(new.title) < 3 then
      raise exception 'BILLA coordinate parser produced an invalid title.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sanitize_billa_coordinate_title on public.leaflet_import_items;
create trigger trg_sanitize_billa_coordinate_title
before insert or update of title, raw_data on public.leaflet_import_items
for each row
execute function public.sanitize_billa_coordinate_item_title();

comment on function public.sanitize_billa_coordinate_title(text) is
  'Removes known BILLA leaflet graphic labels from deterministic coordinate-parser product titles.';
