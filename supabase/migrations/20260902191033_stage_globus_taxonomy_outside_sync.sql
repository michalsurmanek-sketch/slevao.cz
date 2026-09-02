create table if not exists private.globus_taxonomy_stage (
  external_id text primary key,
  category_root text not null,
  category_path text not null,
  category_items jsonb not null default '[]'::jsonb,
  category_source text not null,
  staged_at timestamptz not null default now()
);

create index if not exists globus_taxonomy_stage_staged_at_idx
  on private.globus_taxonomy_stage(staged_at, external_id);

create or replace function public.propagate_globus_source_categories(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_staged integer := 0;
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
  ), candidates as (
    select distinct on (s.external_id)
      s.external_id,s.category_root,s.category_path,s.category_items,s.category_source
    from source_rows s
    join public.products p
      on lower(coalesce(p.metadata->>'source_store_slug',''))='globus'
     and coalesce(p.metadata->>'structured_identity_key',p.metadata->>'structured_external_id','')=s.external_id
    where (p.filter_group is null or btrim(p.filter_group)='')
      and coalesce(p.metadata->>'filter_group_source','') <> 'explicit'
      and public.infer_product_filter_group_source_category_v36('globus',s.category_root,s.category_path) <> 'other'
    order by s.external_id
  )
  insert into private.globus_taxonomy_stage(external_id,category_root,category_path,category_items,category_source,staged_at)
  select external_id,category_root,category_path,category_items,category_source,now()
  from candidates
  on conflict (external_id) do update set
    category_root=excluded.category_root,
    category_path=excluded.category_path,
    category_items=excluded.category_items,
    category_source=excluded.category_source,
    staged_at=excluded.staged_at;

  get diagnostics v_staged = row_count;
  return 0;
end;
$function$;

revoke all on function public.propagate_globus_source_categories(jsonb) from public;
grant execute on function public.propagate_globus_source_categories(jsonb) to service_role;

create or replace function private.drain_globus_taxonomy_stage(p_limit integer default 12)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_taken integer := 0;
  v_updated integer := 0;
  v_deleted integer := 0;
begin
  p_limit := greatest(1, least(coalesce(p_limit,12), 24));

  create temporary table if not exists pg_temp.globus_taxonomy_batch(
    external_id text primary key,
    category_root text,
    category_path text,
    category_items jsonb,
    category_source text
  ) on commit drop;
  truncate pg_temp.globus_taxonomy_batch;

  insert into pg_temp.globus_taxonomy_batch(external_id,category_root,category_path,category_items,category_source)
  select s.external_id,s.category_root,s.category_path,s.category_items,s.category_source
  from private.globus_taxonomy_stage s
  order by s.staged_at,s.external_id
  limit p_limit;
  get diagnostics v_taken = row_count;

  if v_taken = 0 then
    return jsonb_build_object('ok',true,'taken',0,'updated',0,'deleted',0,'remaining',0);
  end if;

  update public.products p
     set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
           'source_store_slug','globus',
           'source_category_root',b.category_root,
           'source_category_path',b.category_path,
           'source_category_items',b.category_items,
           'source_category_source',b.category_source
         ),
         classification_source = 'source-category-v36',
         updated_at = now()
    from pg_temp.globus_taxonomy_batch b
   where lower(coalesce(p.metadata->>'source_store_slug',''))='globus'
     and coalesce(p.metadata->>'structured_identity_key',p.metadata->>'structured_external_id','')=b.external_id
     and (p.filter_group is null or btrim(p.filter_group)='')
     and coalesce(p.metadata->>'filter_group_source','') <> 'explicit'
     and public.infer_product_filter_group_source_category_v36('globus',b.category_root,b.category_path) <> 'other';
  get diagnostics v_updated = row_count;

  delete from private.globus_taxonomy_stage s
  using pg_temp.globus_taxonomy_batch b
  where s.external_id=b.external_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok',true,
    'taken',v_taken,
    'updated',v_updated,
    'deleted',v_deleted,
    'remaining',(select count(*) from private.globus_taxonomy_stage)
  );
end;
$function$;

revoke all on function private.drain_globus_taxonomy_stage(integer) from public;
grant execute on function private.drain_globus_taxonomy_stage(integer) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='drain-globus-taxonomy-stage';

select cron.schedule(
  'drain-globus-taxonomy-stage',
  '* * * * *',
  $$select private.drain_globus_taxonomy_stage(12);$$
);
