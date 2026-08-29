create or replace function public.albert_invalid_food_quantity(p_title text,p_quantity text)
returns boolean
language sql
immutable
set search_path to 'public','pg_catalog'
as $function$
  select
    coalesce(p_quantity,'') ~* '(?:^|[^a-zá-ž])(ks|kus(?:y|ů)?|rol(?:e|í)?|dáv(?:ka|ek|ky)?)(?:$|[^a-zá-ž])'
    and coalesce(p_title,'') ~* '(kaše|cereáli|jogurt|sýr|mléko|smetan|tvaroh|máslo|maso|salám|šunka|klobás|chléb|pečiv|rýže|mouka|cukr|oplat|chips|bonbon|čokolád|zmrzlin|nápoj|sirup|olej|omáčk|kečup|majon|tatarsk|těstovin|müsli|granule|paštik|pomazán|dezert|kapsičk|konzerv|bujón)';
$function$;

create or replace function private.publish_albert_publitas_text_offers_v4_strong_full(p_signature text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare
  v_filtered jsonb;
  v_count integer;
  v_raw_count integer;
  v_variant_only_dropped integer;
  v_semantic_quantity_dropped integer;
  v_result jsonb;
begin
  v_raw_count := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_filtered
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value
  where lower(coalesce(value ->> 'identity_strength', '')) = 'strong'
    and not public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''))
    and not public.albert_invalid_food_quantity(
      coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''),
      value ->> 'quantity_text'
    );

  v_count := jsonb_array_length(v_filtered);

  select count(*)::integer
  into v_variant_only_dropped
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value
  where lower(coalesce(value ->> 'identity_strength', '')) = 'strong'
    and public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''));

  select count(*)::integer
  into v_semantic_quantity_dropped
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value
  where lower(coalesce(value ->> 'identity_strength', '')) = 'strong'
    and not public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''))
    and public.albert_invalid_food_quantity(
      coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''),
      value ->> 'quantity_text'
    );

  if v_count < 50 then
    raise exception 'Albert strong-identity sada po bezpečnostních filtrech obsahuje jen % nabídek; bezpečnostní minimum je 50.', v_count;
  end if;

  v_result := public.publish_albert_publitas_text_offers_v4(p_signature || ':strong-safe-v2',v_filtered);

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'strong_identity_only', true,
    'strong_identity_guard', 'variant-only-v2+food-quantity-v1',
    'strong_input', v_count,
    'raw_input', v_raw_count,
    'variant_only_dropped', v_variant_only_dropped,
    'semantic_quantity_dropped', v_semantic_quantity_dropped
  );
end;
$function$;
