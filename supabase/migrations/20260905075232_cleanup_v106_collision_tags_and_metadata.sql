create or replace function public.guard_product_filter_group_false_positives_v106()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  v_category_id uuid;
  v_target_group text;
  v_target_slug text;
  v_target_tag text;
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then return new; end if;

  if lower(trim(coalesce(new.brand,'')))='radegast' and n ~ '(^| )ryze horka 12( |$)' then
    v_target_group := 'drinks'; v_target_slug := 'napoje'; v_target_tag := 'napoje';
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'food');
  elsif src='kaufland' and (n ~ '(^| )rozprasovac na ocet a olej( |$)' or coalesce(new.metadata->>'kaufland_kl_nr','')='20347246') then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'food');
  elsif n ~ '(^| )(sendvicovac[a-z0-9]*|vaflovac[a-z0-9]*)( |$)' or n ~ '(^| )mlynek na maso( |$)' then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
  elsif ((n ~ '(^| )(trpytiva|rozjasnujici) tycinka( |$)' or n ~ '(^| )tycinka pod oci( |$)') and (lower(trim(coalesce(new.brand,'')))='essence' or src='dm')) then
    v_target_group := 'drugstore'; v_target_slug := 'drogerie'; v_target_tag := 'drogerie';
  elsif n ~ '(^| )vatove tycinky( |$)' then
    v_target_group := 'drugstore'; v_target_slug := 'drogerie'; v_target_tag := 'drogerie';
  elsif n ~ '(^| )peeling na rty( |$)' then
    v_target_group := 'drugstore'; v_target_slug := 'drogerie'; v_target_tag := 'drogerie';
  elsif src='kik' and n ~ '(^| )led lampicka( |$)' then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
  else return new; end if;

  select c.id into v_category_id from public.categories c where c.slug=v_target_slug and c.is_active is true limit 1;
  new.filter_group := v_target_group;
  if v_category_id is not null then new.category_id := v_category_id; end if;
  if v_target_tag is not null and not (v_target_tag = any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags := array_append(coalesce(new.filter_tags,'{}'::text[]),v_target_tag); end if;
  new.classification_confidence := greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source := 'false-positive-guard-v106';
  new.classified_at := now();
  new.metadata := (coalesce(new.metadata,'{}'::jsonb)-'food_subcategory_guard'-'food_subcategory_guard_slug'-'food_subcategory_guard_at') || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_checked_at',now(),'filter_group_false_positive_guard','v106');
  return new;
end;
$function$;

update public.products
set filter_tags = case
      when public.normalize_text(name) ~ '(^| )mlecna ryze( |$)' then case when 'mlecne'=any(array_remove(array_remove(coalesce(filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny')) then array_remove(array_remove(coalesce(filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny') else array_append(array_remove(array_remove(coalesce(filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'mlecne') end
      when public.normalize_text(name) ~ '(^| )kvetakova ryze( |$)' then case when 'ovoce-zelenina'=any(array_remove(array_remove(coalesce(filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny')) then array_remove(array_remove(coalesce(filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny') else array_append(array_remove(array_remove(coalesce(filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'ovoce-zelenina') end
      else filter_tags end,
    metadata = coalesce(metadata,'{}'::jsonb)||jsonb_build_object('v106_collision_cleanup_at',now())
where public.normalize_text(name) ~ '(^| )(mlecna ryze|kvetakova ryze)( |$)';

update public.products
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('v106_false_positive_cleanup_recheck_at',now())
where (lower(trim(coalesce(brand,'')))='radegast' and public.normalize_text(name) ~ '(^| )ryze horka 12( |$)')
   or (lower(trim(coalesce(metadata->>'source_store_slug','')))='kaufland' and (public.normalize_text(name) ~ '(^| )rozprasovac na ocet a olej( |$)' or coalesce(metadata->>'kaufland_kl_nr','')='20347246'));