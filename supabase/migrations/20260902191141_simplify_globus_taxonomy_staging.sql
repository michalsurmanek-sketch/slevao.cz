create or replace function public.propagate_globus_source_categories(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Globus rows must be a JSON array.';
  end if;

  insert into private.globus_taxonomy_stage(
    external_id,category_root,category_path,category_items,category_source,staged_at
  )
  select
    item->>'external_id',
    nullif(trim(item->'metadata'->>'source_category_root'),''),
    nullif(trim(item->'metadata'->>'source_category_path'),''),
    item->'metadata'->'source_category_items',
    nullif(trim(item->'metadata'->>'source_category_source'),''),
    now()
  from jsonb_array_elements(p_rows) item
  where nullif(trim(item->>'external_id'),'') is not null
    and nullif(trim(item->'metadata'->>'source_category_root'),'') is not null
    and nullif(trim(item->'metadata'->>'source_category_path'),'') is not null
    and jsonb_typeof(item->'metadata'->'source_category_items')='array'
    and nullif(trim(item->'metadata'->>'source_category_source'),'') is not null
  on conflict (external_id) do update set
    category_root=excluded.category_root,
    category_path=excluded.category_path,
    category_items=excluded.category_items,
    category_source=excluded.category_source,
    staged_at=excluded.staged_at;

  -- Taxonomy is intentionally decoupled from the main product sync.
  -- Returning 0 makes the Edge Function stop its legacy retry loop immediately.
  return 0;
end;
$function$;

revoke all on function public.propagate_globus_source_categories(jsonb) from public;
grant execute on function public.propagate_globus_source_categories(jsonb) to service_role;
