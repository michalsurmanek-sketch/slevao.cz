-- Only rows with a strong product identity may replace the public Albert set.
-- The underlying v4 publisher still performs its own validation and atomic swap.
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
  v_result jsonb;
begin
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_filtered
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  where lower(coalesce(value ->> 'identity_strength', '')) = 'strong';

  v_count := jsonb_array_length(v_filtered);
  if v_count < 220 then
    raise exception 'Albert strong-identity sada obsahuje jen % nabídek; bezpečnostní minimum je 220.', v_count;
  end if;

  v_result := public.publish_albert_publitas_text_offers_v4(
    p_signature || ':strong',
    v_filtered
  );

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'strong_identity_only', true,
    'strong_input', v_count,
    'raw_input', jsonb_array_length(coalesce(p_rows, '[]'::jsonb))
  );
end;
$function$;

revoke all on function public.publish_albert_publitas_text_offers_v4_strong(text, jsonb) from public;
grant execute on function public.publish_albert_publitas_text_offers_v4_strong(text, jsonb) to service_role;
