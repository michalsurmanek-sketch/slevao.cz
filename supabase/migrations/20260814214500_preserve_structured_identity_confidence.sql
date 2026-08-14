create or replace function public.slevao_enrich_leaflet_item_specification()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_exact_structured_identity boolean := false;
begin
  new.title := public.slevao_offer_display_title(new.title, new.quantity_text, new.unit_label);

  v_exact_structured_identity :=
    nullif(btrim(coalesce(new.raw_data->>'external_id','')), '') is not null
    and nullif(btrim(coalesce(new.raw_data->>'structured_identity_key','')), '') is not null
    and coalesce(new.confidence,0) >= 0.90;

  if not public.slevao_has_specification(new.title)
     and nullif(btrim(coalesce(new.quantity_text, '')), '') is null
     and nullif(btrim(coalesce(new.unit_label, '')), '') is null
     and not v_exact_structured_identity then
    new.raw_data := coalesce(new.raw_data, '{}'::jsonb) || jsonb_build_object(
      'missing_specification', true,
      'specification_review_reason', 'Chybí gramáž, objem, počet kusů, rozměr nebo prodejní jednotka.'
    );
    new.confidence := least(coalesce(new.confidence, 1), 0.69);
    if new.status = 'approved' then
      new.status := 'review';
    end if;
  else
    new.raw_data := coalesce(new.raw_data, '{}'::jsonb)
      - 'missing_specification'
      - 'specification_review_reason';
  end if;

  return new;
end;
$function$;
