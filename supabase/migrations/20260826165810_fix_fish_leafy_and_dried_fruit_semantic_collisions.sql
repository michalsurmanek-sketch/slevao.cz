set local statement_timeout = '90s';

do $migration$
declare
  d text;
  old_dried text := $old_dried$if fruit_any and not meat_context and s ~ '(^| )susen[a-z0-9]*( |$)'$old_dried$;
  new_dried text := $new_dried$if fruit_any and not (meat_species or meat_cut or meat_direct) and s ~ '(^| )susen[a-z0-9]*( |$)'$new_dried$;
begin
  d := pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure);

  if position('tres[a-z0-9]*' in d)=0 then
    raise exception 'fish tres pattern not found';
  end if;
  d := replace(d,'tres[a-z0-9]*','tresk[a-z0-9]*');

  if position('kapr[a-z0-9]*' in d)=0 then
    raise exception 'fish kapr pattern not found';
  end if;
  d := replace(d,'kapr[a-z0-9]*','kapr|kapra');

  if position($old$and s !~ '(^| )(salat[a-z0-9]*|pomazank[a-z0-9]*|pizza|sushi|polevk[a-z0-9]*|omack[a-z0-9]*|prichut[a-z0-9]*)( |$)'$old$ in d)=0 then
    raise exception 'fish exclusion pattern not found';
  end if;
  d := replace(
    d,
    $old$and s !~ '(^| )(salat[a-z0-9]*|pomazank[a-z0-9]*|pizza|sushi|polevk[a-z0-9]*|omack[a-z0-9]*|prichut[a-z0-9]*)( |$)'$old$,
    $new$and s !~ '(^| )(salat[a-z0-9]*|pomazank[a-z0-9]*|pizza|sushi|polevk[a-z0-9]*|omack[a-z0-9]*|prichut[a-z0-9]*|jogurt[a-z0-9]*|smoothie|napoj[a-z0-9]*|sprchov[a-z0-9]*|praci|maska|vuni|kalhot[a-z0-9]*|kosmetik[a-z0-9]*)( |$)'$new$
  );

  if position('  veg := veg_any and not veg_processed;' in d)=0 then
    raise exception 'veg assignment not found';
  end if;
  d := replace(
    d,
    '  veg := veg_any and not veg_processed;',
    E'  veg_processed := veg_processed\n    or s ~ ''(^| )(jogurt[a-z0-9]*|smoothie|napoj[a-z0-9]*|drink|kefir[a-z0-9]*|mlecn[a-z0-9]*|presnid[a-z0-9]*|kapsick[a-z0-9]*)( |$)'';\n\n  veg := veg_any and not veg_processed;'
  );

  if position(old_dried in d)=0 then
    raise exception 'dried fruit condition not found';
  end if;
  d := replace(d,old_dried,new_dried);

  execute d;
end;
$migration$;

select private.refresh_public_offer_search_cache_if_dirty(true);