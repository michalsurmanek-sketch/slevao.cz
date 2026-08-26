do $do$
declare
  v_def text;
begin
  select pg_get_functiondef('public.public_offer_semantic_tags(text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'knedlik[a-z0-9]*', 'knedl[a-z0-9]*');
  v_def := replace(v_def, '|filet[a-z0-9]*|', '|');
  v_def := replace(v_def, '(steak[a-z0-9]*|rizek|rizky|mlete|mlety|mleta|melnene|melneneho)', '(steak[a-z0-9]*|filet[a-z0-9]*|rizek|rizky|mlete|mlety|mleta|melnene|melneneho)');
  execute v_def;
end;
$do$;
