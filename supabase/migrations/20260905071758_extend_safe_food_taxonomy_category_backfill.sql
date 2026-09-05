create or replace function public.preview_product_taxonomy_food_supplement(p_product_id uuid)
returns table(category_slug text, filter_group text, filter_tags text[], confidence numeric, source text)
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_text text;
  v_filter_group text;
begin
  select ' ' || trim(regexp_replace(lower(public.unaccent(coalesce(p.name,'') || ' ' || coalesce(p.brand,''))), '[^a-z0-9]+',' ','g')) || ' ', p.filter_group
    into v_text, v_filter_group
  from public.products p
  where p.id=p_product_id;

  if v_text is null or v_filter_group <> 'food' then return; end if;

  if (
    v_text ~ ' (parecky|parky|polican|tlacenka|utopenci|sekana|kabanos|candat|sumecek|makrelovy|tunakovy|kachna) '
    or (v_text ~ ' (pastika|pastiky) ' and v_text !~ ' (tofu|patifu|rostlinn) ')
  ) then
    return query select 'maso-ryby','food',array['maso']::text[],0.99::numeric,'food-supplement-v1'; return;
  elsif v_text ~ ' (syr|syry|syreck|zerve|camembert|brie|feta|parenica|korbacik|tvaruz|skyr|termix|pribinacek|lipanek|pomazankove|smetanovy dezert) ' then
    return query select 'mlecne-vyrobky','food',array['mlecne']::text[],0.99::numeric,'food-supplement-v1'; return;
  elsif v_text ~ ' (oplatka|oplatky|tatranky|venceky|pendrek|pendreky|lizatko|marshmallows|gummies|brownies|kokosky|pernik|trubicky plnene) ' then
    return query select 'sladkosti','food',array['sladkosti']::text[],0.99::numeric,'food-supplement-v1'; return;
  elsif v_text ~ ' (donut|buchty|vafle|satecek|chlebik) ' then
    return query select 'pecivo','food',array['pecivo']::text[],0.99::numeric,'food-supplement-v1'; return;
  elsif v_text ~ ' (mandarinky|fiky cerstve) ' then
    return query select 'ovoce-zelenina','food',array['ovoce-zelenina']::text[],0.99::numeric,'food-supplement-v1'; return;
  elsif v_text ~ ' (olej|kecup|majoneza|horcice|tatarska omacka|omacka|testoviny|spaghetti|spagety|nudle|ryze|vlocky|musli|cerealie|corn flakes|sul|pohanka|chia seminka|drozdi|pesto|passata|vyvar|ocet|kase|hummus|tortilla|gnocchi|chips|chipsy|bramburky|krupky|snack|snacky|orechy|orisky|pistacie|kukuricne trubicky|cornflakes|balsamico|pyre|presnidavka|detska vyziva) ' then
    return query select 'trvanlive-potraviny','food',array['trvanlive']::text[],0.99::numeric,'food-supplement-v1'; return;
  end if;
end;
$function$;

create or replace function private.refresh_product_taxonomy_candidates()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare v_count integer;
begin
  delete from private.product_taxonomy_candidates;
  insert into private.product_taxonomy_candidates(product_id, product_name, category_slug, filter_group, filter_tags, confidence, source, generated_at)
  select distinct on (p.id)
    p.id,p.name,x.category_slug,x.filter_group,x.filter_tags,x.confidence,x.source,now()
  from public.offers o
  join public.stores s on s.id=o.store_id and s.is_active is true
  join public.products p on p.id=o.product_id and p.is_active is true
  join lateral (
    select * from public.preview_product_taxonomy(p.id)
    union all
    select * from public.preview_product_taxonomy_food_supplement(p.id)
    where not exists (select 1 from public.preview_product_taxonomy(p.id))
  ) x on true
  where o.status='published'
    and o.is_verified is true
    and o.valid_to >= (timezone('Europe/Prague', now()))::date
    and o.valid_from <= (timezone('Europe/Prague', now()))::date + 7
    and x.confidence >= 0.96
  order by p.id,x.confidence desc;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function private.apply_product_taxonomy_candidates(p_limit integer default 25, p_min_confidence numeric default 0.99)
returns table(run_id uuid, applied_count integer)
language plpgsql
security definer
set search_path to 'public', 'private'
set lock_timeout to '500ms'
set statement_timeout to '5s'
as $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_count integer := 0;
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'p_limit must be between 1 and 50'; end if;
  if p_min_confidence < 0.96 or p_min_confidence > 1 then raise exception 'p_min_confidence must be between 0.96 and 1'; end if;

  with candidates as (
    select c.*, cat.id as target_category_id
    from private.product_taxonomy_candidates c
    join public.categories cat on cat.slug=c.category_slug and cat.is_active is true
    join public.products p on p.id=c.product_id
    where c.confidence >= p_min_confidence
      and p.category_id is null
      and (
        (
          (p.filter_group is null or btrim(p.filter_group)='' or p.filter_group='other')
          and coalesce(array_length(p.filter_tags,1),0)=0
          and p.classification_confidence is null
        )
        or p.filter_group=c.filter_group
      )
    order by c.confidence desc,c.product_id
    limit p_limit
  ), logged as (
    insert into private.product_taxonomy_backfill_log(
      run_id,product_id,previous_category_id,previous_filter_group,previous_filter_tags,
      previous_confidence,previous_source,applied_category_id,applied_filter_group,
      applied_filter_tags,applied_confidence,applied_source
    )
    select v_run_id,p.id,p.category_id,p.filter_group,p.filter_tags,
           p.classification_confidence,p.classification_source,c.target_category_id,
           case when p.filter_group is null or btrim(p.filter_group)='' or p.filter_group='other' then c.filter_group else p.filter_group end,
           case when coalesce(array_length(p.filter_tags,1),0)=0 then c.filter_tags else p.filter_tags end,
           greatest(coalesce(p.classification_confidence,0),c.confidence),
           case when p.filter_group=c.filter_group then c.source||'+category' else c.source end
    from candidates c
    join public.products p on p.id=c.product_id
    returning product_id,applied_category_id,applied_filter_group,applied_filter_tags,
              applied_confidence,applied_source
  )
  update public.products p
  set category_id=l.applied_category_id,
      filter_group=l.applied_filter_group,
      filter_tags=l.applied_filter_tags,
      classification_confidence=l.applied_confidence,
      classification_source=l.applied_source,
      classified_at=now(),
      updated_at=now()
  from logged l
  where p.id=l.product_id;

  get diagnostics v_count = row_count;
  return query select v_run_id,v_count;
end;
$function$;