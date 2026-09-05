create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $function$ select 101 $function$;

create or replace function public.guard_product_filter_group_false_positives_v101()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  v_category_id uuid;
  v_target_group text;
  v_target_slug text;
  v_target_tag text;
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then
    return new;
  end if;

  if n ~ '(^| )(sendvicovac[a-z0-9]*|vaflovac[a-z0-9]*)( |$)'
     or n ~ '(^| )mlynek na maso( |$)' then
    v_target_group := 'home';
    v_target_slug := 'domacnost';
    v_target_tag := 'domacnost';
  elsif (
      n ~ '(^| )(trpytiva|rozjasnujici) tycinka( |$)'
      or n ~ '(^| )tycinka pod oci( |$)'
    )
    and (
      lower(trim(coalesce(new.brand,'')))='essence'
      or lower(trim(coalesce(new.metadata->>'source_store_slug','')))='dm'
    ) then
    v_target_group := 'drugstore';
    v_target_slug := 'drogerie';
    v_target_tag := 'drogerie';
  else
    return new;
  end if;

  select c.id into v_category_id
  from public.categories c
  where c.slug=v_target_slug and c.is_active is true
  limit 1;

  new.filter_group := v_target_group;
  if v_category_id is not null then new.category_id := v_category_id; end if;
  if not (v_target_tag = any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags := array_append(coalesce(new.filter_tags,'{}'::text[]),v_target_tag);
  end if;
  new.classification_confidence := greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source := 'false-positive-guard-v101';
  new.classified_at := now();
  new.metadata := coalesce(new.metadata,'{}'::jsonb)
    || jsonb_build_object(
      'filter_group_source','auto_classifier',
      'filter_group_classifier_version',101,
      'filter_group_classifier_checked_version',101,
      'filter_group_classifier_checked_at',now(),
      'filter_group_false_positive_guard','v101'
    );
  return new;
end;
$function$;

drop trigger if exists zzz_filter_group_false_positive_guard_v101 on public.products;
create trigger zzz_filter_group_false_positive_guard_v101
before insert or update of name,brand,category_id,quantity_text,filter_group,metadata
on public.products
for each row execute function public.guard_product_filter_group_false_positives_v101();

update public.products p
set filter_group=p.filter_group
where p.is_active is true
  and coalesce(p.metadata->>'filter_group_source','') <> 'explicit'
  and (
    public.normalize_text(coalesce(p.name,'')) ~ '(^| )(sendvicovac[a-z0-9]*|vaflovac[a-z0-9]*)( |$)'
    or public.normalize_text(coalesce(p.name,'')) ~ '(^| )mlynek na maso( |$)'
    or (
      (
        public.normalize_text(coalesce(p.name,'')) ~ '(^| )(trpytiva|rozjasnujici) tycinka( |$)'
        or public.normalize_text(coalesce(p.name,'')) ~ '(^| )tycinka pod oci( |$)'
      )
      and (
        lower(trim(coalesce(p.brand,'')))='essence'
        or lower(trim(coalesce(p.metadata->>'source_store_slug','')))='dm'
      )
    )
  );