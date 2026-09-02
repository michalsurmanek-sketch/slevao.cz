create or replace function public.sanitize_billa_coordinate_title(p_title text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog','public'
as $function$
declare
  v_title text := regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g');
  v_suffix text := '';
  v_pos integer;
begin
  v_title := btrim(v_title);
  v_pos := strpos(v_title, ' · ');
  if v_pos > 0 then
    v_suffix := substr(v_title, v_pos);
    v_title := substr(v_title, 1, v_pos - 1);
  end if;

  v_title := regexp_replace(v_title, '^\s*(NAVÍC|NOVINKA|IDEÁLNÍ)\s+', '', 'i');
  v_title := regexp_replace(v_title, '^\s*ZDRAVĚJŠÍ\s+VLASY\s+', '', 'i');
  v_title := regexp_replace(v_title, '\s+NA\s+STEAKY\s+', ' ', 'i');
  v_title := regexp_replace(v_title, 'foto\.[[:space:]]*', '', 'i');
  v_title := regexp_replace(v_title, '\s*\|\s*$', '', 'g');
  v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
  return v_title || v_suffix;
end;
$function$;

create or replace function public.sanitize_billa_coordinate_item_title()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
declare
  v_norm text;
begin
  if coalesce(new.raw_data->>'parser','') ~ '^billa-coordinate-v[0-9]+$' then
    new.title := public.sanitize_billa_coordinate_title(new.title);
    if length(new.title) < 3 then
      raise exception 'BILLA coordinate parser produced an invalid title.';
    end if;

    new.title := regexp_replace(new.title, '^\s*•\s*zmrazeno na moři\s+', '', 'i');
    new.title := regexp_replace(new.title, '^\s*k vyvážené stravě\s+', '', 'i');
    new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
    v_norm := lower(unaccent(new.title));

    if v_norm like 'chlazene uzene, marinovane%'
       or v_norm like 'loupana ve varnych saccich%'
       or v_norm like 'valecek falesna svickova vakuum%'
       or v_norm like 'sklepy sumiva vina%' then
      new.status := 'rejected';
      new.raw_data := coalesce(new.raw_data,'{}'::jsonb) || jsonb_build_object('rejected_reason','billa_coordinate_incomplete_title');
    end if;
  end if;
  return new;
end;
$function$;

update public.leaflet_import_items lii
set title=public.sanitize_billa_coordinate_title(lii.title)
from public.leaflet_imports li
join public.stores s on s.id=li.store_id and s.slug='billa'
where lii.import_id=li.id
  and li.status='published'
  and li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date
  and coalesce(lii.raw_data->>'parser','') ~ '^billa-coordinate-v[0-9]+$'
  and lii.title is distinct from public.sanitize_billa_coordinate_title(lii.title);

with current_titles as (
  select distinct on (lii.product_id)
         lii.product_id,lii.title
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id=lii.import_id
  join public.stores s on s.id=li.store_id and s.slug='billa'
  where li.status='published'
    and li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date
    and lii.product_id is not null
    and coalesce(lii.raw_data->>'parser','') ~ '^billa-coordinate-v[0-9]+$'
  order by lii.product_id,lii.id desc
)
update public.offers o
set title=ct.title,updated_at=now()
from current_titles ct
join public.stores s on s.slug='billa'
where o.product_id=ct.product_id
  and o.store_id=s.id
  and o.status='published'
  and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  and o.title is distinct from ct.title;

with current_titles as (
  select distinct on (lii.product_id)
         lii.product_id,lii.title
  from public.leaflet_import_items lii
  join public.leaflet_imports li on li.id=lii.import_id
  join public.stores s on s.id=li.store_id and s.slug='billa'
  where li.status='published'
    and li.detected_valid_to >= (now() at time zone 'Europe/Prague')::date
    and lii.product_id is not null
    and coalesce(lii.raw_data->>'parser','') ~ '^billa-coordinate-v[0-9]+$'
  order by lii.product_id,lii.id desc
)
update public.products p
set name=ct.title,updated_at=now()
from current_titles ct
where p.id=ct.product_id
  and p.name is distinct from ct.title
  and not exists (
    select 1
    from public.offers ox
    join public.stores sx on sx.id=ox.store_id
    where ox.product_id=p.id and sx.slug<>'billa'
  );

create or replace function private.refresh_billa_compatible_page_consensus_v52()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
set statement_timeout to '30s'
as $function$
declare
  v_updated integer := 0;
begin
  with current_billa as (
    select
      o.product_id,
      o.metadata->>'import_id' as import_id,
      (o.metadata->>'leaflet_page')::integer as leaflet_page,
      p.filter_group,
      p.quantity_text
    from public.offers o
    join public.stores st on st.id=o.store_id and st.slug='billa'
    join public.products p on p.id=o.product_id
    where o.status='published'
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
      and nullif(o.metadata->>'import_id','') is not null
      and o.metadata->>'leaflet_page' ~ '^[0-9]+$'
  ), page_stats as (
    select import_id,leaflet_page,
           count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') known_count,
           count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') group_count,
           min(filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') consensus_group
    from current_billa
    group by import_id,leaflet_page
    having count(distinct product_id) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') >= 3
       and count(distinct filter_group) filter (where filter_group is not null and btrim(filter_group)<>'' and filter_group<>'other') = 1
  ), candidates as (
    select distinct p.id,cb.import_id,cb.leaflet_page,ps.consensus_group,ps.known_count
    from current_billa cb
    join page_stats ps using(import_id,leaflet_page)
    join public.products p on p.id=cb.product_id
    where coalesce(nullif(btrim(p.filter_group),''),'other')='other'
      and coalesce(p.metadata->>'filter_group_source','')<>'explicit'
      and (
        (ps.consensus_group='food' and public.normalize_text(coalesce(p.quantity_text,'')) ~ '^[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? (g|kg)$')
        or
        (ps.consensus_group='drinks' and public.normalize_text(coalesce(p.quantity_text,'')) ~ '^[0-9]+([,.][0-9]+)?([ -][0-9]+([,.][0-9]+)?)? (ml|l)$')
      )
  )
  update public.products p
  set metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','billa',
      'source_leaflet_import_id',c.import_id,
      'source_leaflet_page',c.leaflet_page,
      'source_page_consensus_group',c.consensus_group,
      'source_page_consensus_known_count',c.known_count,
      'source_page_consensus_compatibility','food-mass_or_drinks-volume-v52',
      'source_page_consensus_checked_at',now()
  )
  from candidates c
  where p.id=c.id;
  get diagnostics v_updated=row_count;

  return jsonb_build_object('ok',true,'updated',v_updated);
end;
$function$;

revoke all on function private.refresh_billa_compatible_page_consensus_v52() from public,anon,authenticated;
grant execute on function private.refresh_billa_compatible_page_consensus_v52() to postgres,service_role;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 52 $function$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_inferred text;
  v_version integer := public.product_filter_group_classifier_version();
  v_old_auto boolean := false;
  v_new_auto boolean := false;
  v_explicit_change boolean := false;
  v_source_category boolean := false;
  v_kaufland_context boolean := false;
  v_globus_context boolean := false;
  v_page_consensus boolean := false;
  v_source_store text;
  v_source_root text;
  v_source_path text;
  v_consensus_group text;
begin
  if coalesce(new.metadata->>'created_from_kaufland_ssr','false')='true'
     and nullif(trim(coalesce(new.metadata->>'kaufland_category','')),'') is not null
     and nullif(trim(coalesce(new.metadata->>'source_category_root','')),'') is null
     and coalesce(nullif(trim(new.metadata->>'source_store_slug'),''),'kaufland')='kaufland' then
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','kaufland',
      'source_category_root',new.metadata->>'kaufland_category',
      'source_category_path',new.metadata->>'kaufland_category',
      'source_category_items',jsonb_build_array(new.metadata->>'kaufland_category'),
      'source_category_source','kaufland-ssr-category-v1'
    );
  end if;

  v_source_store := new.metadata->>'source_store_slug';
  v_source_root := new.metadata->>'source_category_root';
  v_source_path := new.metadata->>'source_category_path';
  v_consensus_group := lower(trim(coalesce(new.metadata->>'source_page_consensus_group','')));
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';
  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;
  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version') || jsonb_build_object('filter_group_source','explicit','filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
    return new;
  end if;
  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := 'other';
    if lower(trim(coalesce(v_source_store,''))) in ('lidl','hruska','flop','billa')
       and v_consensus_group in ('food','drinks','drugstore','home','garden','electronics','fashion','school','toys','pets','sports','auto','pharmacy') then
      v_inferred := v_consensus_group;
      v_page_consensus := true;
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path);
      v_source_category := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='kaufland' then
      v_inferred := public.infer_product_filter_group_kaufland_context_v46(new.name,v_source_root,new.quantity_text);
      v_kaufland_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='globus' then
      v_inferred := public.infer_product_filter_group_globus_context_v40(new.name);
      v_globus_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_generic_terms_v48(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_source_rules_v33(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata); end if;
    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      if v_page_consensus then
        new.classification_source := case lower(trim(coalesce(v_source_store,''))) when 'flop' then 'source-page-consensus-v47' when 'billa' then 'source-page-consensus-v52' else 'source-page-consensus-v43' end;
      elsif v_source_category then new.classification_source := 'source-category-v41';
      elsif v_kaufland_context then new.classification_source := 'kaufland-context-v46';
      elsif v_globus_context then new.classification_source := 'globus-context-v40';
      elsif public.infer_product_filter_group_generic_terms_v48(new.name,new.quantity_text) <> 'other' then new.classification_source := 'generic-terms-v48';
      elsif public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata) <> 'other' then new.classification_source := 'gap-rules-v34';
      end if;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_version',v_version,'filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_version',v_version);
      end if;
    end if;
  end if;
  return new;
end;
$function$;

do $block$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname='classify-billa-page-consensus' loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule('classify-billa-page-consensus','21 * * * *','select private.refresh_billa_compatible_page_consensus_v52();');
end;
$block$;

select private.refresh_billa_compatible_page_consensus_v52();