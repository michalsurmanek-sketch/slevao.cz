-- Hruska OCR same-column descriptor classifier.
-- Current definition includes the anchor selection later hardened by v92.

create or replace function private.refresh_hruska_column_descriptor_v91()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare v_conflicts integer:=0; v_marked integer:=0;
begin
  with today as (select (now() at time zone 'Europe/Prague')::date d),
  cur as (
    select distinct p.id,p.name,p.quantity_text,p.filter_group,p.classification_source,o.metadata->>'import_id' import_id,nullif(o.metadata->>'leaflet_page','')::int page_no
    from public.offers o join public.products p on p.id=o.product_id join public.stores s on s.id=o.store_id and s.slug='hruska' cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d and p.is_active=true
  ), src as (select import_id,pages from public.leaflet_extracted_text where import_id in (select distinct import_id::uuid from cur where import_id is not null)),
  toks as (select s.import_id,(page->>'page')::int page_no,(tok->>'x')::numeric x,(tok->>'y')::numeric y,tok->>'text' txt from src s cross join lateral jsonb_array_elements(s.pages) page cross join lateral jsonb_array_elements(page->'tokens') tok),
  anchored as (
    select c.*,
      (select t.x from toks t where t.import_id=c.import_id::uuid and t.page_no=c.page_no and length(trim(t.txt))>=4 and lower(split_part(c.name,' · ',1)) like '%'||lower(trim(t.txt))||'%' order by length(trim(t.txt)) desc,t.y desc limit 1) ax,
      (select t.y from toks t where t.import_id=c.import_id::uuid and t.page_no=c.page_no and length(trim(t.txt))>=4 and lower(split_part(c.name,' · ',1)) like '%'||lower(trim(t.txt))||'%' order by length(trim(t.txt)) desc,t.y desc limit 1) ay
    from cur c where c.page_no is not null
  ), descs as (
    select a.*,(select public.normalize_text(string_agg(t.txt,' ' order by t.y desc,t.x)) from toks t where t.import_id=a.import_id::uuid and t.page_no=a.page_no and a.ax is not null and a.ay is not null and abs(t.x-a.ax)<=18 and t.y between a.ay-42 and a.ay+8) descriptor from anchored a
  ), pred as (
    select d.*,case when descriptor ~ '(odlicovaci|tampony|odlakovac|antiperspirant|mydlo|sampon|kapesnik)' then 'drugstore' when descriptor ~ '(mleta|instant)' and public.normalize_text(coalesce(quantity_text,'')) ~ '(g|kg)$' then 'drinks' else 'other' end inferred from descs d
  )
  select count(*) into v_conflicts from pred where inferred<>'other' and filter_group is not null and filter_group<>'other' and filter_group<>inferred;
  if v_conflicts>0 then return jsonb_build_object('ok',false,'blocked',true,'known_conflicts',v_conflicts); end if;

  with today as (select (now() at time zone 'Europe/Prague')::date d),
  cur as (
    select distinct p.id,p.name,p.quantity_text,p.filter_group,p.classification_source,o.metadata->>'import_id' import_id,nullif(o.metadata->>'leaflet_page','')::int page_no
    from public.offers o join public.products p on p.id=o.product_id join public.stores s on s.id=o.store_id and s.slug='hruska' cross join today t
    where o.status='published' and o.is_verified=true and o.valid_from<=t.d and o.valid_to>=t.d and p.is_active=true
      and (coalesce(nullif(btrim(p.filter_group),''),'other')='other' or p.classification_source='source-column-descriptor-v91')
  ), src as (select import_id,pages from public.leaflet_extracted_text where import_id in (select distinct import_id::uuid from cur where import_id is not null)),
  toks as (select s.import_id,(page->>'page')::int page_no,(tok->>'x')::numeric x,(tok->>'y')::numeric y,tok->>'text' txt from src s cross join lateral jsonb_array_elements(s.pages) page cross join lateral jsonb_array_elements(page->'tokens') tok),
  anchored as (
    select c.*,
      (select t.x from toks t where t.import_id=c.import_id::uuid and t.page_no=c.page_no and length(trim(t.txt))>=4 and lower(split_part(c.name,' · ',1)) like '%'||lower(trim(t.txt))||'%' order by length(trim(t.txt)) desc,t.y desc limit 1) ax,
      (select t.y from toks t where t.import_id=c.import_id::uuid and t.page_no=c.page_no and length(trim(t.txt))>=4 and lower(split_part(c.name,' · ',1)) like '%'||lower(trim(t.txt))||'%' order by length(trim(t.txt)) desc,t.y desc limit 1) ay
    from cur c where c.page_no is not null
  ), descs as (
    select a.*,(select public.normalize_text(string_agg(t.txt,' ' order by t.y desc,t.x)) from toks t where t.import_id=a.import_id::uuid and t.page_no=a.page_no and a.ax is not null and a.ay is not null and abs(t.x-a.ax)<=18 and t.y between a.ay-42 and a.ay+8) descriptor from anchored a
  ), cand as (
    select d.*,case when descriptor ~ '(odlicovaci|tampony|odlakovac|antiperspirant|mydlo|sampon|kapesnik)' then 'drugstore' when descriptor ~ '(mleta|instant)' and public.normalize_text(coalesce(quantity_text,'')) ~ '(g|kg)$' then 'drinks' else 'other' end grp from descs d
  )
  update public.products p set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('source_store_slug','hruska','source_page_consensus_group',c.grp,'source_page_consensus_version','91','source_hruska_descriptor',c.descriptor,'source_hruska_descriptor_checked_at',now()) from cand c where p.id=c.id and c.grp<>'other';
  get diagnostics v_marked=row_count;
  return jsonb_build_object('ok',true,'blocked',false,'known_conflicts',0,'marked',v_marked);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe set search_path to 'public','pg_temp'
as $function$ select 91 $function$;

do $patch$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,
    $$when 'hruska' then 'source-page-consensus-v43'$$,
    $$when 'hruska' then case when coalesce(new.metadata->>'source_page_consensus_version','')='91' then 'source-column-descriptor-v91' else 'source-page-consensus-v43' end$$);
  if v_new=v_def then raise exception 'v91 classifier label patch failed'; end if;
  execute v_new;
end;
$patch$;

do $schedule$
declare r record;
begin
  for r in select jobid from cron.job where jobname='classify-hruska-column-descriptor-v91' loop perform cron.unschedule(r.jobid); end loop;
  perform cron.schedule('classify-hruska-column-descriptor-v91','18 * * * *','select private.refresh_hruska_column_descriptor_v91();');
end;
$schedule$;