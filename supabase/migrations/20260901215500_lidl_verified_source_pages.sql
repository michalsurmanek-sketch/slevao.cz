-- Conservatively attach verified Lidl import items to official leaflet pages.
-- Page identity comes from official Lidl flyerJson keywords, never from inferred PDF ordinality.

create or replace function private.backfill_lidl_verified_source_pages(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_import record;
  v_total integer := 0;
  v_existing integer := 0;
  v_candidates integer := 0;
  v_updated integer := 0;
begin
  select li.id,li.store_id,li.source_document_url,li.status,li.metadata
    into v_import
  from public.leaflet_imports li
  join public.stores s on s.id=li.store_id and s.slug='lidl'
  where li.id=p_import_id
    and li.metadata->>'adapter'='lidl-verified-pdf-text-v1';

  if not found then
    return jsonb_build_object('ok',true,'skipped',true,'reason','not_lidl_verified_import','import_id',p_import_id);
  end if;
  if v_import.status <> 'published' then
    return jsonb_build_object('ok',true,'skipped',true,'reason','import_not_published','import_id',p_import_id,'status',v_import.status);
  end if;
  if v_import.source_document_url is null then
    return jsonb_build_object('ok',true,'skipped',true,'reason','missing_source_document','import_id',p_import_id);
  end if;
  if not exists(
    select 1
    from public.leaflet_document_pages p
    where p.store_id=v_import.store_id
      and p.source_document_url=v_import.source_document_url
      and p.source_kind='lidl-official-flyer-json-v1'
  ) then
    return jsonb_build_object('ok',true,'skipped',true,'reason','official_pages_not_ready','import_id',p_import_id);
  end if;

  select count(*)::integer,
         count(*) filter(where source_page is not null)::integer
    into v_total,v_existing
  from public.leaflet_import_items
  where import_id=p_import_id
    and status='published';

  with pages as (
    select p.page_number,
           trim(regexp_replace(lower(extensions.unaccent(coalesce(p.keywords,''))),'[^a-z0-9]+',' ','g')) as page_text
    from public.leaflet_document_pages p
    where p.store_id=v_import.store_id
      and p.source_document_url=v_import.source_document_url
      and p.source_kind='lidl-official-flyer-json-v1'
  ), items as (
    select i.id,i.title,
           trim(regexp_replace(
             lower(extensions.unaccent(
               regexp_replace(i.title,'\s*[·•]\s*[0-9]+(?:[.,][0-9]+)?\s*(?:g|kg|ml|l|ks)\s*$','','i')
             )),
             '[^a-z0-9]+',' ','g'
           )) as name_text
    from public.leaflet_import_items i
    where i.import_id=p_import_id
      and i.status='published'
      and i.source_page is null
  ), title_tokens as (
    select i.id,tok
    from items i,
    lateral regexp_split_to_table(i.name_text,'\s+') tok
    where length(tok)>=3
      and tok !~ '^[0-9]+$'
      and tok not in (
        'uspora','merne','cene','porovnani','produktem','standardne','nabizene','velikosti',
        'rozsirena','nabidka','cena','platna','standardni','ml','kg','ks'
      )
  ), token_counts as (
    select id,count(distinct tok)::numeric as total_tokens
    from title_tokens
    group by id
  ), scored as (
    select i.id,p.page_number,
           count(distinct tt.tok) filter(
             where (' '||p.page_text||' ') like '% '||tt.tok||' %'
           )::numeric as matched_tokens,
           tc.total_tokens,
           case when tc.total_tokens>0 then
             count(distinct tt.tok) filter(
               where (' '||p.page_text||' ') like '% '||tt.tok||' %'
             )::numeric/tc.total_tokens
           else 0 end as coverage
    from items i
    join token_counts tc on tc.id=i.id
    cross join pages p
    left join title_tokens tt on tt.id=i.id
    group by i.id,p.page_number,tc.total_tokens,p.page_text
  ), ranked as (
    select *,
           row_number() over(partition by id order by coverage desc,matched_tokens desc,page_number) as rn,
           lead(coverage) over(partition by id order by coverage desc,matched_tokens desc,page_number) as second_coverage
    from scored
  ), candidates as (
    select id,page_number,matched_tokens,total_tokens,coverage,coalesce(second_coverage,0) as second_coverage
    from ranked
    where rn=1
      and total_tokens>=2
      and coverage=1
      and coalesce(second_coverage,0)<=0.75
  ), counted as (
    select count(*)::integer as n from candidates
  ), updated as (
    update public.leaflet_import_items i
       set source_page=c.page_number,
           raw_data=coalesce(i.raw_data,'{}'::jsonb)||jsonb_build_object(
             'source_page_source','lidl-official-flyer-json-v1-keywords-v1',
             'source_page_match_coverage',c.coverage,
             'source_page_matched_tokens',c.matched_tokens,
             'source_page_total_tokens',c.total_tokens,
             'source_page_second_coverage',c.second_coverage,
             'source_page_matched_at',clock_timestamp()
           ),
           updated_at=clock_timestamp()
      from candidates c
     where i.id=c.id
       and i.source_page is null
    returning i.id
  )
  select (select n from counted),count(*)::integer
    into v_candidates,v_updated
  from updated;

  return jsonb_build_object(
    'ok',true,
    'skipped',false,
    'import_id',p_import_id,
    'total_published_items',v_total,
    'preexisting_source_pages',v_existing,
    'safe_candidates',v_candidates,
    'updated',v_updated,
    'remaining_without_source_page',greatest(v_total-v_existing-v_updated,0),
    'source','lidl-official-flyer-json-v1-keywords-v1'
  );
end;
$function$;

revoke all on function private.backfill_lidl_verified_source_pages(uuid) from public, anon, authenticated;
grant execute on function private.backfill_lidl_verified_source_pages(uuid) to service_role;

create or replace function public.backfill_lidl_verified_source_pages_internal(p_import_id uuid)
returns jsonb
language sql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
  select private.backfill_lidl_verified_source_pages(p_import_id);
$function$;

revoke all on function public.backfill_lidl_verified_source_pages_internal(uuid) from public, anon, authenticated;
grant execute on function public.backfill_lidl_verified_source_pages_internal(uuid) to service_role;

create or replace function private.backfill_lidl_source_pages_after_publish()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if new.status='published'
     and new.metadata->>'adapter'='lidl-verified-pdf-text-v1'
     and (
       tg_op='INSERT'
       or old.status is distinct from new.status
       or old.metadata->>'page_identity_synced_at' is distinct from new.metadata->>'page_identity_synced_at'
       or old.metadata->>'page_identity_available' is distinct from new.metadata->>'page_identity_available'
     ) then
    perform private.backfill_lidl_verified_source_pages(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function private.backfill_lidl_source_pages_after_publish() from public, anon, authenticated;

drop trigger if exists trg_lidl_verified_source_pages_after_publish on public.leaflet_imports;
create trigger trg_lidl_verified_source_pages_after_publish
after insert or update of status, metadata on public.leaflet_imports
for each row
execute function private.backfill_lidl_source_pages_after_publish();
