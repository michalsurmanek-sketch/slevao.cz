do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_name text;
begin
  for v_oid,v_name in
    select p.oid,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f'
      and n.nspname='public'
      and p.proname = any(array[
        'invoke_action_products_sync',
        'invoke_action_source_sync',
        'invoke_billa_publitas_sync',
        'invoke_ca_products_sync',
        'invoke_cropp_products_sync',
        'invoke_house_products_sync',
        'invoke_ikea_products_sync',
        'invoke_intersport_products_sync',
        'invoke_petcenter_products_sync',
        'invoke_reserved_products_sync',
        'invoke_sinsay_products_sync'
      ]::text[])
  loop
    v_def := pg_get_functiondef(v_oid);
    v_new := regexp_replace(v_def,'timeout_milliseconds[[:space:]]*:=[[:space:]]*60000','timeout_milliseconds := 120000','g');
    if v_new=v_def then
      raise exception 'Expected 60000ms timeout not found in %',v_name;
    end if;
    execute v_new;
  end loop;
end $$;