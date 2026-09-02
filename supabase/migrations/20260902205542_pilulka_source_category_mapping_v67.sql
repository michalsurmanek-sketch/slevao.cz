create or replace function public.infer_product_filter_group_source_category_v37(p_store_slug text,p_category_root text,p_category_path text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  v_store text := lower(trim(coalesce(p_store_slug,'')));
  v_root text := public.normalize_text(coalesce(p_category_root,''));
  v_path text := public.normalize_text(coalesce(p_category_path,''));
begin
  if v_store='kaufland' then
    if v_root='dum domacnost' then return 'home'; end if;
    if v_root='lahudky konzervy' then return 'food'; end if;
    if v_root='napoje lihoviny' then return 'drinks'; end if;
    if v_root='cerstve ryby' then return 'food'; end if;
  end if;
  if v_store='pilulka' then
    if v_path ~ 'pro zdravi miminka.*nosik' then return 'pharmacy'; end if;
    if v_path ~ 'kojeni.*masazni olej' then return 'drugstore'; end if;
  end if;
  return public.infer_product_filter_group_source_category_v36(p_store_slug,p_category_root,p_category_path);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer language sql immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 67 $function$;

update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)
where p.is_active is true
  and coalesce(nullif(btrim(p.filter_group),''),'other')='other'
  and exists (
    select 1 from public.offers o join public.stores s on s.id=o.store_id
    where o.product_id=p.id and s.slug='pilulka' and o.status='published' and o.is_verified=true
      and o.valid_from <= (now() at time zone 'Europe/Prague')::date
      and o.valid_to >= (now() at time zone 'Europe/Prague')::date
  );