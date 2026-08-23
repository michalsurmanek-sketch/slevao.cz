create or replace function public.publish_globus_olomouc_offers(
  p_signature text,
  p_rows jsonb,
  p_source_document_url text default 'https://www.globus.cz/olomouc/hypermarket/akcni-nabidka',
  p_parser_version text default 'globus-action-products-api-v1',
  p_reported_total_count integer default null,
  p_accessible_product_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
set statement_timeout to '180s'
as $$
declare
  v_result jsonb;
  v_store_id uuid;
  v_import_id uuid;
  v_source_id uuid;
  v_scoped integer := 0;
  v_input integer := jsonb_array_length(coalesce(p_rows,'[]'::jsonb));
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Globus rows must be a JSON array.';
  end if;
  if v_input < 300 or v_input > 1000 then
    raise exception 'Globus scoped snapshot has unsafe size: %.', v_input;
  end if;
  if p_accessible_product_count is not null and p_accessible_product_count <> v_input then
    raise exception 'Globus accessible count % does not match row count %.', p_accessible_product_count, v_input;
  end if;
  if p_reported_total_count is not null and p_reported_total_count < v_input then
    raise exception 'Globus reported total % is below accessible rows %.', p_reported_total_count, v_input;
  end if;
  if p_reported_total_count is not null and p_reported_total_count - v_input > 100 then
    raise exception 'Globus reported/accessibility gap is too large: % vs %.', p_reported_total_count, v_input;
  end if;

  v_result := public.publish_structured_store_offers(
    'globus',
    'globus-action-products-api-v1',
    p_signature,
    p_rows,
    300,
    1000,
    p_source_document_url,
    p_parser_version
  );

  select id into v_store_id from public.stores where slug='globus';
  if v_store_id is null then raise exception 'Globus store not found.'; end if;
  v_import_id := nullif(v_result->>'import_id','')::uuid;
  if v_import_id is null then raise exception 'Globus publisher did not return import_id.'; end if;

  update public.offers
     set coverage_scope='city',
         region_code=null,
         city_name='Olomouc',
         store_location_name='Globus Olomouc',
         metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
           'branch','Olomouc',
           'house_number',4008,
           'coverage_scope','city',
           'api_reported_total_count',p_reported_total_count,
           'api_accessible_product_count',v_input
         ),
         updated_at=now()
   where store_id=v_store_id
     and status='published'
     and metadata->>'adapter'='globus-action-products-api-v1'
     and metadata->>'source_signature'=p_signature;
  get diagnostics v_scoped = row_count;

  if v_scoped < 300 then
    raise exception 'Globus publisher created only % scoped offers.', v_scoped;
  end if;

  update public.leaflet_imports
     set coverage_scope='city',
         region_code=null,
         city_name='Olomouc',
         store_location_name='Globus Olomouc',
         metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
           'branch','Olomouc',
           'house_number',4008,
           'coverage_scope','city',
           'api_reported_total_count',p_reported_total_count,
           'api_accessible_product_count',v_input,
           'pagination_complete',true
         ),
         updated_at=now()
   where id=v_import_id;

  select source_id into v_source_id from public.leaflet_imports where id=v_import_id;
  update public.leaflet_sources
     set name='Globus Olomouc – akční nabídka API',
         source_url=p_source_document_url,
         source_type='api',
         adapter_key='globus-action-products-api-v1',
         extraction_strategy='structured_api',
         last_error=null,
         updated_at=now()
   where id=v_source_id;

  update public.store_product_sync_state
     set adapter_name='globus-action-products-api-v1',
         adapter_version=p_parser_version,
         parser_version=p_parser_version,
         source_type='official-structured-api',
         source_category='branch-action-offer',
         health_status='ok',
         health_reason=format('Globus Olomouc: publikováno %s oficiálních API nabídek; API reportuje %s.',v_scoped,coalesce(p_reported_total_count,v_scoped)),
         last_error=null,
         last_parser_error=null,
         updated_at=now()
   where store_id=v_store_id;

  return v_result || jsonb_build_object(
    'coverage_scope','city',
    'city_name','Olomouc',
    'store_location_name','Globus Olomouc',
    'house_number',4008,
    'scoped_offers',v_scoped,
    'reported_total_count',p_reported_total_count,
    'accessible_product_count',v_input
  );
end;
$$;

revoke all on function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer) from public;
revoke all on function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer) from anon;
revoke all on function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer) from authenticated;
grant execute on function public.publish_globus_olomouc_offers(text,jsonb,text,text,integer,integer) to service_role;
