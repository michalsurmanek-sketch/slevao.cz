-- Turn the conservative v4 JIP OCR candidates into an ordinary reviewed import.
-- Existing publish-imports remains the single publication path and applies its
-- normal product matching, price-history and offer safety rules.

create or replace function public.prepare_jip_spatial_ocr_v4(p_source_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  src public.leaflet_imports%rowtype;
  v_store_slug text;
  v_candidate_count integer;
  v_bad_count integer;
  v_import_id uuid;
  v_hash text;
  v_existing_status text;
begin
  select * into src from public.leaflet_imports where id=p_source_import_id;
  if not found then raise exception 'JIP source import nebyl nalezen.'; end if;

  select slug into v_store_slug from public.stores where id=src.store_id;
  if v_store_slug is distinct from 'jip' then raise exception 'Import nepatří obchodu JIP.'; end if;
  if src.detected_valid_to is null or src.detected_valid_to <= (now() at time zone 'Europe/Prague')::date then
    raise exception 'JIP source import není nadcházející/platný pro bezpečnou publikaci.';
  end if;
  if coalesce(src.metadata->>'ocr_complete','false')<>'true' then
    raise exception 'JIP OCR není kompletní.';
  end if;

  select count(*),count(*) filter(where price<2 or price>5000 or confidence<0.90 or length(normalized_title)<4)
  into v_candidate_count,v_bad_count
  from public.jip_spatial_ocr_candidates_v4(p_source_import_id);

  if v_candidate_count < 3 then
    raise exception 'JIP v4 našel jen % bezpečných kandidátů; předchozí data zůstávají.',v_candidate_count;
  end if;
  if v_candidate_count > 150 or v_bad_count>0 then
    raise exception 'JIP v4 kandidátní sada neprošla bezpečnostní kontrolou (% kandidátů, % vadných).',v_candidate_count,v_bad_count;
  end if;

  v_hash := 'jip-spatial-v4-'||p_source_import_id::text;
  select id,status into v_import_id,v_existing_status
  from public.leaflet_imports where source_hash=v_hash limit 1;

  if v_import_id is null then
    insert into public.leaflet_imports(
      source_id,store_id,source_document_url,source_hash,status,product_count,confidence,
      coverage_scope,region_code,city_name,store_location_name,
      detected_valid_from,detected_valid_to,metadata,started_at
    ) values (
      src.source_id,src.store_id,src.source_document_url,v_hash,'review',v_candidate_count,0.95,
      coalesce(src.coverage_scope,'national'),src.region_code,src.city_name,src.store_location_name,
      src.detected_valid_from,src.detected_valid_to,
      jsonb_build_object(
        'parser','jip-spatial-ocr-v4','deterministic',true,'verified_pipeline',true,
        'source_import_id',p_source_import_id,'ocr_engine',src.metadata->>'ocr_engine',
        'candidate_count',v_candidate_count,'coverage_label','JIP potraviny – dle omezení uvedených v letáku'
      ),now()
    ) returning id into v_import_id;
  elsif v_existing_status='published' then
    return jsonb_build_object('ok',true,'existing',true,'published',true,'import_id',v_import_id,'candidate_count',v_candidate_count);
  else
    delete from public.leaflet_import_items where import_id=v_import_id;
    update public.leaflet_imports
    set status='review',product_count=v_candidate_count,confidence=0.95,error_message=null,
        detected_valid_from=src.detected_valid_from,detected_valid_to=src.detected_valid_to,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'parser','jip-spatial-ocr-v4','deterministic',true,'verified_pipeline',true,
          'source_import_id',p_source_import_id,'ocr_engine',src.metadata->>'ocr_engine','candidate_count',v_candidate_count
        ),updated_at=now()
    where id=v_import_id;
  end if;

  insert into public.leaflet_import_items(
    import_id,title,quantity_text,price,source_page,confidence,status,raw_data
  )
  select v_import_id,c.title,c.quantity_text,c.price,c.source_page,c.confidence,'approved',c.raw_data
  from public.jip_spatial_ocr_candidates_v4(p_source_import_id) c
  order by c.source_page,c.title,c.price;

  update public.leaflet_imports set finished_at=now(),updated_at=now() where id=v_import_id;

  return jsonb_build_object('ok',true,'existing',false,'published',false,'import_id',v_import_id,'candidate_count',v_candidate_count);
end;
$function$;

revoke execute on function public.prepare_jip_spatial_ocr_v4(uuid) from public,anon,authenticated;
grant execute on function public.prepare_jip_spatial_ocr_v4(uuid) to service_role;
