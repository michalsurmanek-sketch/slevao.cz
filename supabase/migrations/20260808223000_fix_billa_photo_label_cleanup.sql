create or replace function public.sanitize_billa_coordinate_title(p_title text)
returns text
language plpgsql
immutable
as $$
declare
  v_title text := regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g');
  v_suffix text := '';
  v_pos integer;
begin
  v_title := btrim(v_title);
  v_pos := strpos(v_title, ' · ');
  if v_pos > 0 then
    v_suffix := substr(v_title, v_pos);
    v_title := substr(v_title, 1, v_pos - 1);
  end if;

  v_title := regexp_replace(v_title, '^\s*(NAVÍC|NOVINKA|IDEÁLNÍ)\s+', '', 'i');
  v_title := regexp_replace(v_title, '\s+NA\s+STEAKY\s+', ' ', 'i');
  v_title := regexp_replace(v_title, 'foto\.[[:space:]]*', '', 'i');
  v_title := regexp_replace(v_title, '\s*\|\s*$', '', 'g');
  v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
  return v_title || v_suffix;
end;
$$;

update public.leaflet_import_items
set title = public.sanitize_billa_coordinate_title(title)
where coalesce(raw_data->>'parser', '') = 'billa-coordinate-v1'
  and title is distinct from public.sanitize_billa_coordinate_title(title);
