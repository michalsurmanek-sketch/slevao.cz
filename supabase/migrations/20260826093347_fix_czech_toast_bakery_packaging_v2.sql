set local statement_timeout = '60s';

do $migration$
declare
  d text;
  old_pack text := $old$s ~ '(^| )(toastov[a-z0-9]* chleb|sendvic[a-z0-9]* chleb|sandwich toastov[a-z0-9]* chleb)( |$)'$old$;
  new_pack text := $new$s ~ '(^| )((toastov|toustov)[a-z0-9]* chleb|sendvic[a-z0-9]* chleb|sandwich (toastov|toustov)[a-z0-9]* chleb)( |$)'$new$;
  old_fresh text := $old2$s !~ '(^| )(toastov[a-z0-9]*|sendvic[a-z0-9]*|sandwich|pita)( |$)'$old2$;
  new_fresh text := $new2$s !~ '(^| )((toastov|toustov)[a-z0-9]*|sendvic[a-z0-9]*|sandwich|pita)( |$)'$new2$;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);
  if position(old_pack in d) = 0 or position(old_fresh in d) = 0 then
    raise exception 'expected bakery packaging patterns not found';
  end if;
  d := replace(d, old_pack, new_pack);
  d := replace(d, old_fresh, new_fresh);
  execute d;
end;
$migration$;

refresh materialized view private.public_offer_search_cache;
