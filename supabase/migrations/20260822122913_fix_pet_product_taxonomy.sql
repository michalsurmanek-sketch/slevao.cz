do $migration$
declare
  fn text := pg_get_functiondef('public.infer_public_filter_group(text,text)'::regprocedure);
  needle text := $n$when n ~ '\m(krmivo|granule|stelivo|whiskas|pedigree|purina)\M' then 'pets'$n$;
  replacement text := $r$when n ~ '\m(krmivo|granule|stelivo|whiskas|pedigree|purina|akinu|dingo|dog snaq|prevital|vetamix|vitakraft|huhubamboo|propesko|shinycat|felix fantastic)\M'
      or n ~ '\m(pro psy|pro kocky|pro psa|kapsicky pro psy|kapsicky pro kocky|konzerva pro psy|konzerva pro kocky|pamlsk[a-z]*)\M'
      then 'pets'$r$;
begin
  if fn is null or position(needle in fn)=0 then
    raise exception 'pet fallback guard not found in infer_public_filter_group';
  end if;
  execute replace(fn,needle,replacement);
end;
$migration$;

do $migration$
declare
  fn text := pg_get_functiondef('public.preview_product_taxonomy(uuid)'::regprocedure);
  needle text := $n$if coalesce(v_stores && array['ca','cropp','house','reserved','takko']::text[], false) then$n$;
  replacement text := $r$if (
    v_text ~ ' (akinu|dingo|vitakraft|vetamix|prevital|huhubamboo|propesko|shinycat) '
    or v_text ~ ' dog snaq '
    or (v_text ~ ' felix ' and v_text ~ ' (kapsick|kock|krmivo|granule) ')
    or v_text ~ ' (krmivo|pamlsek|pamlsky|granule|stelivo) '
    or v_text ~ ' kapsicky pro (kocky|psy) '
    or v_text ~ ' konzerva pro (kocky|psy) '
  ) then return query select 'zvirata','pets',array['zvirata']::text[],0.99::numeric,'pet-brand-v1'; return;
  elsif coalesce(v_stores && array['ca','cropp','house','reserved','takko']::text[], false) then$r$;
begin
  if fn is null or position(needle in fn)=0 then
    raise exception 'taxonomy insertion guard not found in preview_product_taxonomy';
  end if;
  execute replace(fn,needle,replacement);
end;
$migration$;

with pet_category as (
  select id
  from public.categories
  where slug='zvirata' and is_active is true
  limit 1
), corrected as (
  update public.products p
  set category_id=pc.id,
      filter_group='pets',
      filter_tags=array['zvirata']::text[],
      classification_confidence=greatest(coalesce(p.classification_confidence,0),0.99),
      classification_source='pet-brand-v1',
      classified_at=now(),
      updated_at=now()
  from pet_category pc
  where (
      public.normalize_text(coalesce(p.brand,'')) ~ '\m(akinu|dingo|dog snaq natural|vetamix|vitakraft)\M'
      or public.normalize_text(p.name) ~ '\m(prevital)\M'
      or (public.normalize_text(coalesce(p.brand,''))='felix' and public.normalize_text(p.name) ~ '\m(kapsick|kock|krmiv|granule)')
    )
    and (
      p.filter_group is distinct from 'pets'
      or p.category_id is distinct from pc.id
      or p.filter_tags is distinct from array['zvirata']::text[]
    )
  returning p.id
)
select count(*) from corrected;