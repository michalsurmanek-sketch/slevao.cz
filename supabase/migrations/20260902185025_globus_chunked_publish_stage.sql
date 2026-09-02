create table if not exists private.globus_offer_stage (
  signature text not null,
  external_id text not null,
  row_data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (signature, external_id)
);

create index if not exists globus_offer_stage_created_idx
  on private.globus_offer_stage(created_at);

create or replace function public.stage_globus_offer_chunk(
  p_signature text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_input integer;
  v_total integer;
begin
  if nullif(trim(coalesce(p_signature,'')),'') is null then
    raise exception 'Globus staging signature is required.';
  end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Globus staging rows must be a JSON array.';
  end if;
  v_input := jsonb_array_length(p_rows);
  if v_input < 1 or v_input > 100 then
    raise exception 'Globus staging chunk has unsafe size: %.', v_input;
  end if;

  delete from private.globus_offer_stage
  where created_at < now() - interval '1 day';

  insert into private.globus_offer_stage(signature,external_id,row_data,created_at)
  select p_signature, item->>'external_id', item, now()
  from jsonb_array_elements(p_rows) item
  where nullif(trim(item->>'external_id'),'') is not null
  on conflict (signature,external_id)
  do update set row_data=excluded.row_data, created_at=excluded.created_at;

  select count(*)::integer into v_total
  from private.globus_offer_stage
  where signature=p_signature;

  return jsonb_build_object('ok',true,'chunk_input',v_input,'staged_total',v_total);
end;
$function$;

create or replace function public.finalize_globus_staged_offers(
  p_signature text,
  p_source_document_url text,
  p_parser_version text,
  p_reported_total_count integer,
  p_accessible_product_count integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '180s'
set lock_timeout to '30s'
as $function$
declare
  v_rows jsonb;
  v_count integer;
  v_result jsonb;
begin
  select coalesce(jsonb_agg(row_data order by external_id),'[]'::jsonb), count(*)::integer
    into v_rows,v_count
  from private.globus_offer_stage
  where signature=p_signature;

  if v_count <> p_accessible_product_count then
    raise exception 'Globus staged rows % do not match validated count %.', v_count, p_accessible_product_count;
  end if;
  if v_count < 300 or v_count > 1000 then
    raise exception 'Globus staged snapshot has unsafe size: %.', v_count;
  end if;

  v_result := public.publish_globus_olomouc_offers(
    p_signature,
    v_rows,
    p_source_document_url,
    p_parser_version,
    p_reported_total_count,
    p_accessible_product_count
  );

  delete from private.globus_offer_stage where signature=p_signature;
  return coalesce(v_result,'{}'::jsonb)
    || jsonb_build_object('staged_rows',v_count,'chunked_publish',true);
end;
$function$;

revoke all on function public.stage_globus_offer_chunk(text,jsonb) from public;
grant execute on function public.stage_globus_offer_chunk(text,jsonb) to service_role;
revoke all on function public.finalize_globus_staged_offers(text,text,text,integer,integer) from public;
grant execute on function public.finalize_globus_staged_offers(text,text,text,integer,integer) to service_role;
