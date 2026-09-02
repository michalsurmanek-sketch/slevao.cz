update public.offers o
set external_id = o.external_id || ':' || to_char(o.valid_from,'YYYY-MM-DD'),
    updated_at = now()
from public.stores s
where s.id=o.store_id
  and s.slug='penny'
  and coalesce(o.metadata->>'adapter','')='penny-structured-html-v1'
  and o.external_id like 'penny-web:%'
  and o.external_id !~ ':[0-9]{4}-[0-9]{2}-[0-9]{2}$';

update public.leaflet_import_items lii
set raw_data = jsonb_set(
  lii.raw_data,
  '{external_id}',
  to_jsonb((lii.raw_data->>'external_id') || ':' || li.detected_valid_from::text),
  true
)
from public.leaflet_imports li
join public.stores s on s.id=li.store_id
where lii.import_id=li.id
  and s.slug='penny'
  and li.metadata->>'adapter'='penny-structured-html-v1'
  and li.detected_valid_from is not null
  and lii.raw_data->>'external_id' like 'penny-web:%'
  and lii.raw_data->>'external_id' !~ ':[0-9]{4}-[0-9]{2}-[0-9]{2}$';

do $$
declare
  v_def text;
  v_old text := $old$   and o.external_id='penny-web:'||p.external_id
$old$;
  v_new text := $new$   and o.external_id='penny-web:'||p.external_id||':'||to_char(p.valid_from,'YYYY-MM-DD')
$new$;
begin
  v_def := pg_get_functiondef('private.penny_structured_html_matches_published_set(text,uuid,text,integer,date,date)'::regprocedure);
  if strpos(v_def,v_old)=0 then
    raise exception 'PENNY matcher external identity anchor not found';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$$;

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.publish_penny_structured_html(text,bigint)'::regprocedure);

  v_old := $old$  v_offer_id uuid;
  v_offer_ids uuid[]:=array[]::uuid[];$old$;
  v_new := $new$  v_offer_id uuid;
  v_external_id text;
  v_offer_ids uuid[]:=array[]::uuid[];$new$;
  if strpos(v_def,v_old)=0 then raise exception 'PENNY publisher declaration anchor not found'; end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$    v_offer_id:=null;
    select o.id into v_offer_id
    from public.offers o
    where o.store_id=v_store_id
      and o.external_id='penny-web:'||v_row.external_id
      and o.valid_from=v_row.valid_from
      and o.valid_to=v_row.valid_to
    limit 1;$old$;
  v_new := $new$    v_external_id:='penny-web:'||v_row.external_id||':'||to_char(v_row.valid_from,'YYYY-MM-DD');
    v_offer_id:=null;
    select o.id into v_offer_id
    from public.offers o
    where o.store_id=v_store_id
      and o.external_id=v_external_id
      and o.valid_from=v_row.valid_from
      and o.valid_to=v_row.valid_to
    limit 1;$new$;
  if strpos(v_def,v_old)=0 then raise exception 'PENNY publisher lookup anchor not found'; end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$        v_product_id,v_store_id,'penny-web:'||v_row.external_id,v_row.title,v_row.normalized_title,$old$;
  v_new := $new$        v_product_id,v_store_id,v_external_id,v_row.title,v_row.normalized_title,$new$;
  if strpos(v_def,v_old)=0 then raise exception 'PENNY publisher insert identity anchor not found'; end if;
  v_def := replace(v_def,v_old,v_new);

  v_old := $old$      v_row.metadata||jsonb_build_object('offer_id',v_offer_id,'external_id','penny-web:'||v_row.external_id)$old$;
  v_new := $new$      v_row.metadata||jsonb_build_object('offer_id',v_offer_id,'external_id',v_external_id)$new$;
  if strpos(v_def,v_old)=0 then raise exception 'PENNY import item identity anchor not found'; end if;
  v_def := replace(v_def,v_old,v_new);

  execute v_def;
end;
$$;
