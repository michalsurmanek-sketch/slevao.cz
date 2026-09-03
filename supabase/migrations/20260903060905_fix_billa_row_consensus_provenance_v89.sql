do $do$
declare v_def text;
begin
  v_def:=pg_get_functiondef('private.refresh_billa_unit_row_consensus_v88()'::regprocedure);
  if position($needle$'source_page_consensus_version','88',$needle$ in v_def)=0 then
    raise exception 'BILLA row consensus metadata block changed';
  end if;
  v_def:=replace(v_def,
    $old$'source_page_consensus_version','88',$old$,
    $new$'source_store_slug','billa',
       'source_store_source','billa-unit-row-consensus-v89',
       'source_page_consensus_version','88',$new$);
  execute v_def;
end
$do$;

select private.refresh_billa_unit_row_consensus_v88();
