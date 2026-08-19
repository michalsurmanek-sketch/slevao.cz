-- Recovered production migration 20260812152609.
-- Albert strong-identity parsing became intentionally conservative after the
-- identity hardening work. Align the strong wrapper's absolute floor with the
-- already-existing v4 publisher floor while keeping the variant-only guard.
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

  if v_count < 80 then
    raise exception 'Albert strong-identity sada po odstranění neúplných variant obsahuje jen % nabídek; bezpečnostní minimum je 80.', v_count;
  end if;

  v_result := public.publish_albert_publitas_text_offers_v4(
    p_signature || ':strong-safe-v2',
    v_filtered
  );

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'strong_identity_only', true,
    'strong_identity_guard', 'variant-only-v2',
    'strong_input', v_count,
    'raw_input', v_raw_count,
    'variant_only_dropped', v_variant_only_dropped
  );
end;
$function$;

revoke all on function public.publish_albert_publitas_text_offers_v4_strong(text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_albert_publitas_text_offers_v4_strong(text, jsonb) to service_role;
