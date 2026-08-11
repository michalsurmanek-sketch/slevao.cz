-- A medicine title can contain dose units (mg) and still be sold as a package
-- of tablets/pastilles. For product identity, the trailing tablet count is the
-- package quantity and must take precedence over the active-ingredient dose.

create or replace function public.product_quantity_key(value text)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  source_text text := lower(unaccent(coalesce(value, '')));
  parts text[];
  last_parts text[];
  amount numeric;
  multiplier numeric;
  unit_key text;
  total numeric;
  medicine_count text;
begin
  medicine_count := (regexp_match(
    source_text,
    '(?:tableta|tablety|tablet|pastilka|pastilky|tobolka|tobolky|kapsle|draze)[^0-9]{0,40}([0-9]{1,4})[[:space:]]*$'
  ))[1];
  if medicine_count is not null then
    return medicine_count || 'ks';
  end if;

  for parts in
    select regexp_matches(
      source_text,
      '([0-9]+)\s*[x×]\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|mg|g|ml|cl|l|ks|kus|kusy|kusu|davka|davky|davek|role|roli|rol|baleni)([^[:alpha:]]|$)',
      'g'
    )
  loop
    last_parts := parts;
  end loop;

  if last_parts is not null then
    multiplier := replace(last_parts[1], ',', '.')::numeric;
    amount := replace(last_parts[2], ',', '.')::numeric;
    unit_key := last_parts[3];
    if unit_key='kg' then total:=multiplier*amount*1000; return trim_scale(total)::text||'g'; end if;
    if unit_key='mg' then total:=multiplier*amount/1000; return trim_scale(total)::text||'g'; end if;
    if unit_key='g' then total:=multiplier*amount; return trim_scale(total)::text||'g'; end if;
    if unit_key='l' then total:=multiplier*amount*1000; return trim_scale(total)::text||'ml'; end if;
    if unit_key='cl' then total:=multiplier*amount*10; return trim_scale(total)::text||'ml'; end if;
    if unit_key='ml' then total:=multiplier*amount; return trim_scale(total)::text||'ml'; end if;
    unit_key := case unit_key
      when 'kus' then 'ks' when 'kusy' then 'ks' when 'kusu' then 'ks'
      when 'davky' then 'davka' when 'davek' then 'davka'
      when 'roli' then 'role' when 'rol' then 'role'
      when 'baleni' then 'bal'
      else unit_key
    end;
    return trim_scale(multiplier*amount)::text||unit_key;
  end if;

  last_parts := null;
  for parts in
    select regexp_matches(
      source_text,
      '([0-9]+(?:[.,][0-9]+)?)\s*(kg|mg|g|ml|cl|l|ks|kus|kusy|kusu|davka|davky|davek|role|roli|rol|baleni)([^[:alpha:]]|$)',
      'g'
    )
  loop
    last_parts := parts;
  end loop;

  if last_parts is null then return null; end if;
  amount := replace(last_parts[1], ',', '.')::numeric;
  unit_key := last_parts[2];
  if unit_key='kg' then return trim_scale(amount*1000)::text||'g'; end if;
  if unit_key='mg' then return trim_scale(amount/1000)::text||'g'; end if;
  if unit_key='g' then return trim_scale(amount)::text||'g'; end if;
  if unit_key='l' then return trim_scale(amount*1000)::text||'ml'; end if;
  if unit_key='cl' then return trim_scale(amount*10)::text||'ml'; end if;
  if unit_key='ml' then return trim_scale(amount)::text||'ml'; end if;
  unit_key := case unit_key
    when 'kus' then 'ks' when 'kusy' then 'ks' when 'kusu' then 'ks'
    when 'davky' then 'davka' when 'davek' then 'davka'
    when 'roli' then 'role' when 'rol' then 'role'
    when 'baleni' then 'bal'
    else unit_key
  end;
  return trim_scale(amount)::text||unit_key;
end;
$function$;
