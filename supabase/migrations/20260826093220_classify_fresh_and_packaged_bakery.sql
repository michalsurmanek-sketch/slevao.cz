set local statement_timeout = '60s';

do $migration$
declare
  d text;
  old_block text := $old$  -- Forma pečiva je označena jen při explicitním důkazu v názvu.
  -- Raději 0 výsledků než vydávat balený výrobek za čerstvý.
  bread_fresh := bread and s ~ '(^| )cerstv[a-z0-9]*( |$)';
  bread_packaged := bread and s ~ '(^| )(balen[a-z0-9]*|baleni|multipack)( |$)';$old$;
  new_block text := $new$  -- Forma pečiva: nejdřív spolehlivě oddělíme balené/trvanlivé výrobky.
  -- Čerstvé pak znamená skutečné pekařské pečivo bez signálu baleného výrobku,
  -- ne pouze výrobek, který má náhodou slovo „čerstvé“ v názvu.
  bread_packaged := bread and (
    s ~ '(^| )(balen[a-z0-9]*|baleni|multipack|rodinne baleni)( |$)'
    or s ~ '(^| )(toastov[a-z0-9]* chleb|sendvic[a-z0-9]* chleb|sandwich toastov[a-z0-9]* chleb)( |$)'
    or s ~ '(^| )(7 days|7days|bauli|colussi|penam|schar|olz|tastino|fizistyle)( |$)'
    or s ~ '(^| )cajov[a-z0-9]* peciv[a-z0-9]*( |$)'
  );

  bread_fresh := bread and not bread_packaged and (
    s ~ '(^| )cerstv[a-z0-9]*( |$)'
    or s ~ '(^| )(rohlik[a-z0-9]*|housk[a-z0-9]*|kaiserka|bulk[a-z0-9]*|baget[a-z0-9]*|koblih[a-z0-9]*|donut[a-z0-9]*|muffin[a-z0-9]*|kolac[a-z0-9]*|buchta|loupak[a-z0-9]*)( |$)'
    or (
      s ~ '(^| )croissant[a-z0-9]*( |$)'
      and s !~ '(^| )(7 days|7days|bauli|fizistyle)( |$)'
    )
    or (
      s ~ '(^| )chleb[a-z0-9]*( |$)'
      and s !~ '(^| )(toastov[a-z0-9]*|sendvic[a-z0-9]*|sandwich|pita)( |$)'
    )
  );$new$;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);
  if position(old_block in d) = 0 then
    raise exception 'public_offer_semantic_tags bakery form block does not match expected base';
  end if;
  d := replace(d, old_block, new_block);
  execute d;
end;
$migration$;

refresh materialized view private.public_offer_search_cache;
