create or replace function private.propagate_globus_unresolved_source_category(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_updated integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Globus rows must be a JSON array.';
  end if;

  with source_rows as (
    select
      item->>'external_id' as external_id,
      nullif(trim(item->'metadata'->>'source_category_root'),'') as category_root,
      nullif(trim(item->'metadata'->>'source_category_path'),'') as category_path,
      item->'metadata'->'source_category_items' as category_items,
      nullif(trim(item->'metadata'->>'source_category_source'),'') as category_source
    from jsonb_array_elements(p_rows) item
    where nullif(trim(item->>'external_id'),'') is not null
      and nullif(trim(item->'metadata'->>'source_category_root'),'') is not null
      and nullif(trim(item->'metadata'->>'source_category_path'),'') is not null
      and jsonb_typeof(item->'metadata'->'source_category_items')='array'
      and nullif(trim(item->'metadata'->>'source_category_source'),'') is not null
  ), prepared as (
    select s.*,
           public.infer_product_filter_group_source_category_v36('globus',s.category_root,s.category_path) as inferred_group
    from source_rows s
  ), candidates as (
    select p.id,s.category_root,s.category_path,s.category_items,s.category_source,s.inferred_group
    from prepared s
    join public.products p
      on lower(coalesce(p.metadata->>'source_store_slug',''))='globus'
     and coalesce(p.metadata->>'structured_identity_key',p.metadata->>'structured_external_id','')=s.external_id
    where (p.filter_group is null or btrim(p.filter_group)='')
      and coalesce(p.metadata->>'filter_group_source','') <> 'explicit'
      and s.inferred_group <> 'other'
    order by p.id
    limit 12
  )
  update public.products p
     set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
           'source_category_root',c.category_root,
           'source_category_path',c.category_path,
           'source_category_items',c.category_items,
           'source_category_source',c.category_source
         ),
         classification_source = 'source-category-v36',
         updated_at = now()
    from candidates c
   where p.id=c.id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;