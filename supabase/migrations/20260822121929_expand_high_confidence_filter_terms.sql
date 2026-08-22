do $migration$
declare
  fn text := pg_get_functiondef('public.infer_public_filter_group(text,text)'::regprocedure);
  needle text := $needle$      then 'food'
    else 'other'$needle$;
  replacement text := $replacement$      then 'food'
    when n ~ '\m(finish|persil|ariel|nivea|garnier|linteo)\M'
      or n ~ '\mkapsle do mycky\M'
      then 'drugstore'
    when n ~ '\m(ice tea|tonic water|espresso|jogurtovy drink|milkshake|shake)\M'
      then 'drinks'
    when n ~ '\m(omacka|pomazanka|termix|piskoty|spekacky|camembert|majoneza|nudle|nutella|susenky|uzeniny|arasidy|bonbony|chipsy|niva|parky|cerealie|filety|popcorn|krokety|lasagne|karbanatky|ocet|koreni|pralinky|oplatky|hamburger|koblizek|krupicka|polivka|chlebicky|ryzove nudle)\M'
      then 'food'
    else 'other'$replacement$;
begin
  if fn is null or position(needle in fn) = 0 then
    raise exception 'infer_public_filter_group insertion guard not found';
  end if;
  execute replace(fn, needle, replacement);
end;
$migration$;

create or replace function public.resolve_public_filter_group(
  p_name text,
  p_category_slug text default null::text,
  p_store_slug text default null::text
)
returns text
language plpgsql
immutable parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  base_group text := public.infer_public_filter_group(p_name, p_category_slug);
  n text := public.normalize_text(coalesce(p_name,''));
begin
  if base_group <> 'other' then
    return base_group;
  end if;

  if p_store_slug = 'kaufland' and n ~ '\m(parkside|livarno)\M' then
    return 'home';
  end if;

  if p_store_slug = any (array['cropp','house','reserved','takko','ca']) then
    return 'fashion';
  end if;

  if p_store_slug = any (array['asko','jysk','ikea','bauhaus','pro-doma','dek','obi']) then
    return 'home';
  end if;

  return base_group;
end;
$function$;