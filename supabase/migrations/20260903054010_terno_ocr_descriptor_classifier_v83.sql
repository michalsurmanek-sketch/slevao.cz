create or replace function public.infer_product_filter_group_terno_ocr_descriptor_v83(p_descriptor text,p_quantity_text text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text:=public.normalize_text(coalesce(p_descriptor,''));
  q text:=lower(btrim(coalesce(p_quantity_text,'')));
begin
  if q ~ '^(cca[[:space:]]+)?[0-9]+([,.][0-9]+)?([[:space:]]*[-–][[:space:]]*[0-9]+([,.][0-9]+)?)?[[:space:]]*(g|kg)$'
     and n ~ '(^| )(susenky|krekry|oplatky|oplatka|tycinky|tycinka|bonbony|bonbon|cokolada|pudding|yogurt)( |$)' then return 'food'; end if;
  if q ~ '^(cca[[:space:]]+)?[0-9]+([,.][0-9]+)?([[:space:]]*[-–][[:space:]]*[0-9]+([,.][0-9]+)?)?[[:space:]]*(ml|l)$'
     and n ~ '(^| )(pivo|vino|napoj|limonada|smoothie)( |$)' then return 'drinks'; end if;
  return 'other';
end;
$function$;

create or replace function private.refresh_terno_ocr_descriptors_v83()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare v_updated integer:=0;
begin
  with current_terno as (
    select distinct p.id product_id,li.id item_id,li.source_page,li.raw_data,
           (i.metadata->>'source_import_id')::uuid source_import_id,
           ((li.raw_data->'quantity_coordinates'->>'top')::numeric+(li.raw_data->'quantity_coordinates'->>'bottom')::numeric)/2 qy,
           (li.raw_data->'quantity_coordinates'->>'left')::numeric qx
    from public.offers o
    join public.stores s on s.id=o.store_id and s.slug='terno'
    join public.products p on p.id=o.product_id
    join public.leaflet_import_items li on li.product_id=p.id and li.import_id=(o.metadata->>'import_id')::uuid
    join public.leaflet_imports i on i.id=li.import_id
    where o.status='published' and o.is_verified=true
      and o.valid_from <= (now() at time zone 'Europe/Prague')::date
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
      and li.raw_data->>'parser'='terno-ocr-spatial-unit-price-v5'
      and li.raw_data->'quantity_coordinates' is not null
      and i.metadata->>'source_import_id' ~ '^[0-9a-f-]{36}$'
  ), word_rows as (
    select ct.*,w.ord,
           (w.val->>'block')::int block_id,(w.val->>'top')::numeric wt,(w.val->>'left')::numeric wl,
           (w.val->>'width')::numeric ww,(w.val->>'height')::numeric wh,w.val->>'text' word_text,
           coalesce((w.val->>'confidence')::numeric,0) conf
    from current_terno ct
    join public.leaflet_ocr_pages op on op.import_id=ct.source_import_id and op.page_number=ct.source_page
    cross join lateral jsonb_array_elements(op.words) with ordinality w(val,ord)
    where jsonb_typeof(op.words)='array' and w.val ? 'block' and w.val ? 'top' and w.val ? 'left' and w.val ? 'width' and w.val ? 'height'
  ), block_stats as (
    select product_id,item_id,block_id,min(wt) top,max(wt+wh) bottom,
           min(abs((wt+wh/2)-qy)+abs(wl-qx)*0.12) proximity
    from word_rows where conf>=45 group by product_id,item_id,block_id
  ), chosen as (
    select distinct on (bs.product_id,bs.item_id) bs.product_id,bs.item_id,bs.block_id,bs.proximity
    from block_stats bs join current_terno ct on ct.product_id=bs.product_id and ct.item_id=bs.item_id
    where bs.top<=ct.qy+24 and bs.bottom>=ct.qy-24
    order by bs.product_id,bs.item_id,bs.proximity,bs.block_id
  ), descriptors as (
    select wr.product_id,c.block_id,c.proximity,
           btrim(string_agg(wr.word_text,' ' order by wr.wl,wr.ord) filter (where wr.conf>=45)) descriptor
    from word_rows wr join chosen c on c.product_id=wr.product_id and c.item_id=wr.item_id and c.block_id=wr.block_id
    group by wr.product_id,c.block_id,c.proximity having c.proximity<=12
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
      'source_store_slug','terno','source_ocr_descriptor',d.descriptor,
      'source_ocr_descriptor_block',d.block_id,'source_ocr_descriptor_proximity',round(d.proximity,2),
      'source_ocr_descriptor_source','terno-nearest-quantity-block-v83','source_ocr_descriptor_checked_at',now())
  from descriptors d
  where p.id=d.product_id and nullif(d.descriptor,'') is not null
    and (p.metadata->>'source_ocr_descriptor' is distinct from d.descriptor
      or p.metadata->>'source_ocr_descriptor_source' is distinct from 'terno-nearest-quantity-block-v83');
  get diagnostics v_updated=row_count;
  return jsonb_build_object('ok',true,'updated',v_updated);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 83 $function$;

do $patch_classifier$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,
    $q$v_albert_context boolean := false; v_catalog_consensus boolean := false; v_page_consensus boolean := false;$q$,
    $q$v_albert_context boolean := false; v_terno_ocr_context boolean := false; v_catalog_consensus boolean := false; v_page_consensus boolean := false;$q$);
  if v_new=v_def then raise exception 'v83 classifier patch failed at declaration'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,
    $q$if v_inferred='other' then v_inferred:=public.infer_product_filter_group_generic_terms_v81(new.name,new.quantity_text); end if;$q$,
    $q$if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='terno' and coalesce(new.metadata->>'source_ocr_descriptor_source','')='terno-nearest-quantity-block-v83' then v_inferred:=public.infer_product_filter_group_terno_ocr_descriptor_v83(new.metadata->>'source_ocr_descriptor',new.quantity_text); v_terno_ocr_context:=v_inferred<>'other'; end if;
    if v_inferred='other' then v_inferred:=public.infer_product_filter_group_generic_terms_v81(new.name,new.quantity_text); end if;$q$);
  if v_new=v_def then raise exception 'v83 classifier patch failed at descriptor inference'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,
    $q$elsif v_albert_context then new.classification_source:='albert-context-v64'; elsif public.infer_product_filter_group_generic_terms_v81$q$,
    $q$elsif v_albert_context then new.classification_source:='albert-context-v64'; elsif v_terno_ocr_context then new.classification_source:='terno-ocr-descriptor-v83'; elsif public.infer_product_filter_group_generic_terms_v81$q$);
  if v_new=v_def then raise exception 'v83 classifier patch failed at source attribution'; end if;
  execute v_new;
end;
$patch_classifier$;

select private.refresh_terno_ocr_descriptors_v83();

do $schedule$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='classify-terno-ocr-descriptors' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('classify-terno-ocr-descriptors','24 * * * *','select private.refresh_terno_ocr_descriptors_v83();');
end;
$schedule$;