-- Albert's strong parser intentionally publishes only rows with a stable
-- title+quantity identity. A fixed absolute floor became stale when the live
-- strong-identity feed naturally settled below 80 rows. Keep an absolute floor
-- for bootstrap, but compare replacements against the current non-expired live
-- set and require at least 90% of the accepted input to survive DB validation.

do $patch$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.publish_albert_publitas_text_offers_v4(text,jsonb)'::regprocedure);

  if v_def not like '%pg_advisory_xact_lock(hashtextextended(''slevao:albert-publitas-v4'', 0))%' then
    raise exception 'Albert v4 publisher serialization guard is missing; refusing live-floor patch.';
  end if;
  if v_def not like '%v_product_norm := public.normalize_product_name(v_title);%' then
    raise exception 'Albert v4 product-key hardening is missing; refusing live-floor patch.';
  end if;
  if v_def not like '%if v_input_count < 80 then raise exception ''Albert v4 parser našel jen % nabídek; bezpečnostní minimum je 80.''%' then
    raise exception 'Albert v4 input-floor insertion point changed.';
  end if;
  if v_def not like '%if v_published<80 then raise exception ''Albert v4 po bezpečnostních filtrech ponechal jen % nabídek; předchozí sada zůstává zachovaná.''%' then
    raise exception 'Albert v4 published-floor insertion point changed.';
  end if;

  v_new := replace(
    v_def,
    E'  v_input_count integer := jsonb_array_length(coalesce(p_rows, ''[]''::jsonb));\n  v_published integer := 0;',
    E'  v_input_count integer := jsonb_array_length(coalesce(p_rows, ''[]''::jsonb));\n  v_live_count integer := 0;\n  v_safe_min integer := 80;\n  v_today date := (timezone(''Europe/Prague'', now()))::date;\n  v_published integer := 0;'
  );

  v_new := replace(
    v_new,
    E'  if coalesce(length(p_signature), 0) < 16 then raise exception ''Albert v4 signature je neplatný.''; end if;\n  if v_input_count < 80 then raise exception ''Albert v4 parser našel jen % nabídek; bezpečnostní minimum je 80.'', v_input_count; end if;\n  if v_input_count > 900 then raise exception ''Albert v4 parser našel podezřele mnoho nabídek: %.'', v_input_count; end if;\n\n  select id into v_store_id from public.stores where slug = ''albert'';\n  if v_store_id is null then raise exception ''Albert obchod nebyl nalezen.''; end if;',
    E'  if coalesce(length(p_signature), 0) < 16 then raise exception ''Albert v4 signature je neplatný.''; end if;\n  if v_input_count > 900 then raise exception ''Albert v4 parser našel podezřele mnoho nabídek: %.'', v_input_count; end if;\n\n  select id into v_store_id from public.stores where slug = ''albert'';\n  if v_store_id is null then raise exception ''Albert obchod nebyl nalezen.''; end if;\n\n  select count(*)::integer into v_live_count\n  from public.offers\n  where store_id = v_store_id\n    and status = ''published''\n    and valid_to >= v_today;\n\n  v_safe_min := case\n    when v_live_count >= 50 then greatest(50, floor(v_live_count * 0.60)::integer)\n    else 80\n  end;\n\n  if v_input_count < v_safe_min then\n    raise exception ''Albert v4 parser našel jen % nabídek proti % neexpirovaným veřejným; bezpečné minimum je %.'', v_input_count, v_live_count, v_safe_min;\n  end if;'
  );

  v_new := replace(
    v_new,
    E'  if v_published<80 then raise exception ''Albert v4 po bezpečnostních filtrech ponechal jen % nabídek; předchozí sada zůstává zachovaná.'',v_published; end if;',
    E'  if v_published < greatest(v_safe_min, ceil(v_input_count * 0.90)::integer) then\n    raise exception ''Albert v4 po bezpečnostních filtrech ponechal jen %/% nabídek; požadované minimum je % a předchozí sada zůstává zachovaná.'', v_published, v_input_count, greatest(v_safe_min, ceil(v_input_count * 0.90)::integer);\n  end if;'
  );

  v_new := replace(
    v_new,
    E'''created_products'',v_created,''signature'',p_signature);',
    E'''created_products'',v_created,''signature'',p_signature,''live_offer_count'',v_live_count,''safe_min'',v_safe_min,''required_published'',greatest(v_safe_min,ceil(v_input_count * 0.90)::integer));'
  );

  if v_new = v_def
     or v_new like '%if v_input_count < 80 then%'
     or v_new like '%if v_published<80 then%' then
    raise exception 'Albert v4 live-floor patch did not apply cleanly.';
  end if;

  execute v_new;
end
$patch$;

create or replace function public.publish_albert_publitas_text_offers_v4_strong(
  p_signature text,
  p_rows jsonb
)
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
  v_result jsonb;
  v_store_id uuid;
  v_live_count integer := 0;
  v_safe_min integer := 80;
  v_today date := (timezone('Europe/Prague', now()))::date;
begin
  v_raw_count := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_filtered
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  where lower(coalesce(value ->> 'identity_strength', '')) = 'strong'
    and not public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''));

  v_count := jsonb_array_length(v_filtered);
  v_variant_only_dropped := (
    select count(*)::integer
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) value
    where lower(coalesce(value ->> 'identity_strength', '')) = 'strong'
      and public.albert_variant_only_label(coalesce(value ->> 'title', value #>> '{metadata,raw_title}', ''))
  );

  select id into v_store_id from public.stores where slug = 'albert';
  if v_store_id is null then raise exception 'Albert obchod nebyl nalezen.'; end if;

  select count(*)::integer into v_live_count
  from public.offers
  where store_id = v_store_id
    and status = 'published'
    and valid_to >= v_today;

  v_safe_min := case
    when v_live_count >= 50 then greatest(50, floor(v_live_count * 0.60)::integer)
    else 80
  end;

  if v_count < v_safe_min then
    raise exception 'Albert strong-identity sada po odstranění neúplných variant obsahuje jen % nabídek proti % neexpirovaným veřejným; bezpečnostní minimum je %.', v_count, v_live_count, v_safe_min;
  end if;

  v_result := public.publish_albert_publitas_text_offers_v4(
    p_signature || ':strong-safe-v2',
    v_filtered
  );

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'strong_identity_only', true,
    'strong_identity_guard', 'variant-only-v2-live-relative',
    'strong_input', v_count,
    'raw_input', v_raw_count,
    'variant_only_dropped', v_variant_only_dropped,
    'live_offer_count', v_live_count,
    'safe_min', v_safe_min
  );
end;
$function$;

revoke all on function public.publish_albert_publitas_text_offers_v4_strong(text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_albert_publitas_text_offers_v4_strong(text, jsonb) to service_role;
