do $migration$
declare d text;
begin
  d := pg_get_functiondef('public.public_semantic_offer_matches(text,text[],text,text)'::regprocedure);
  d := replace(d,
    $$when 'milk_fullfat' then return has_milk and (n ~ '(^| )plnotuc[a-z0-9]*( |$)' or n ~ '(^| )3 5 %( |$)' or n ~ '(^| )3 6 %( |$)');$$,
    $$when 'milk_fullfat' then return has_milk and (n ~ '(^| )plnotuc[a-z0-9]*( |$)' or n ~ '(^| )3 5( |$)' or n ~ '(^| )3 6( |$)');$$
  );
  d := replace(d,
    $$when 'milk_semiskim' then return has_milk and (n ~ '(^| )polotuc[a-z0-9]*( |$)' or n ~ '(^| )1 5 %( |$)');$$,
    $$when 'milk_semiskim' then return has_milk and n ~ '(^| )polotuc[a-z0-9]*( |$)';$$
  );
  execute d;
end;
$migration$;