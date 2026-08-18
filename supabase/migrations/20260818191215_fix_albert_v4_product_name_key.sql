do $migration$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.publish_albert_publitas_text_offers_v4(text,jsonb)'::regprocedure)
    into v_def;

  if v_def like '%v_product_norm text;%' then
    return;
  end if;

  v_new := replace(v_def, E'  v_norm text;\n  v_qty text;', E'  v_norm text;\n  v_product_norm text;\n  v_qty text;');
  v_new := replace(v_new, E'    v_norm := trim(coalesce(v_row->>''normalized_title'',''''));\n    v_qty :=', E'    v_norm := trim(coalesce(v_row->>''normalized_title'',''''));\n    v_product_norm := public.normalize_product_name(v_title);\n    v_qty :=');
  v_new := replace(v_new, E'=v_norm\n        and (v_qty is null', E'=v_product_norm\n        and (v_qty is null');
  v_new := replace(v_new, E'=v_norm\n        and ((v_qty is null', E'=v_product_norm\n        and ((v_qty is null');
  v_new := replace(v_new, 'values(v_title,v_norm,v_brand,v_qty,v_image,', 'values(v_title,v_product_norm,v_brand,v_qty,v_image,');

  if v_new = v_def
     or v_new not like '%v_product_norm text;%'
     or v_new not like '%v_product_norm := public.normalize_product_name(v_title)%'
     or v_new like '%coalesce(p.normalized_name,public.normalize_product_name(p.name))=v_norm%' then
    raise exception 'Albert v4 product-key patch did not apply cleanly.';
  end if;

  execute v_new;
end
$migration$;

comment on function public.publish_albert_publitas_text_offers_v4(text,jsonb)
is 'Albert Publitas v4 publisher. Uses product-name-only normalized key for product reuse, while offer normalized_title may include quantity. Serialized by advisory lock slevao:albert-publitas-v4.';
