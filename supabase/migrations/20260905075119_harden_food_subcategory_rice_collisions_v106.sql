drop trigger if exists zzz_filter_group_false_positive_guard_v104 on public.products;
drop trigger if exists zzzzzz_safe_food_subcategory_guard_v105 on public.products;

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
    new.filter_tags := array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'food');
  elsif src='kaufland' and (n ~ '(^| )rozprasovac na ocet a olej( |$)' or coalesce(new.metadata->>'kaufland_kl_nr','')='20347246') then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
    new.filter_tags := array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'food');
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
  else
    return new;
  end if;

  select c.id into v_category_id from public.categories c where c.slug=v_target_slug and c.is_active is true limit 1;
  new.filter_group := v_target_group;
  if v_category_id is not null then new.category_id := v_category_id; end if;
  if v_target_tag is not null and not (v_target_tag = any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags := array_append(coalesce(new.filter_tags,'{}'::text[]),v_target_tag); end if;
  new.classification_confidence := greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source := 'false-positive-guard-v106';
  new.classified_at := now();
  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_checked_at',now(),'filter_group_false_positive_guard','v106');
  return new;
end;
$function$;

revoke execute on function public.guard_product_filter_group_false_positives_v106() from public, anon, authenticated;

create trigger zzz_filter_group_false_positive_guard_v106
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata on public.products
for each row execute function public.guard_product_filter_group_false_positives_v106();

create or replace function public.guard_safe_food_subcategory_v106()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  source_cat text := trim(coalesce(new.metadata->>'source_category_root',new.metadata->>'source_category_path',''));
  v_slug text;
  v_tag text;
  v_category_id uuid;
begin
  if new.filter_group is distinct from 'food' or new.category_id is not null then return new; end if;
  if n ~ '(^| )mlecna ryze( |$)' then v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )kvetakova ryze( |$)' then v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif src='kaufland' and source_cat='Maso, drůbež, uzeniny' then v_slug:='maso-ryby'; v_tag:='maso';
  elsif src='kaufland' and source_cat='Ovoce, zelenina, rostliny' then v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif n ~ '(^| )(vejce|zmrzlina|nanuk|jogurt|kefir|smetana|tvaroh|tvaruzky|gervais|syrecek)( |$)' then v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(testoviny|mouka|cukr|skrob|bulgur|krupice|ocet|olivy|instantni polevka|pringles|cheetos)( |$)' or (n ~ '(^| )ryze( |$)' and n !~ '(^| )(mlecna ryze|kvetakova ryze|ryze horka)( |$)') then v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(bagetka|listove testo|muffin|muffiny|minidonut|donut|focaccina|piadina|bulka)( |$)' then v_slug:='pecivo'; v_tag:='pecivo';
  elsif n ~ '(^| )(spekacky|klobasy|klobasky|sunka|salam|makrela|sardina|sardinky|sardinela|rybi filety|filety z aljasske tresky|aspikovy)( |$)' then v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )(3bit|schokobons|bonboniera|studentska pecet|halls drops|kavenky|mila)( |$)' then v_slug:='sladkosti'; v_tag:='sladkosti';
  else return new; end if;
  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if v_tag is not null and not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v106';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard','v106','food_subcategory_guard_slug',v_slug,'food_subcategory_guard_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v106() from public, anon, authenticated;
create trigger zzzzzz_safe_food_subcategory_guard_v106 before insert or update of name, category_id, quantity_text, filter_group, metadata on public.products for each row execute function public.guard_safe_food_subcategory_v106();

update public.products set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('v106_false_positive_recheck_at',now())
where (lower(trim(coalesce(brand,'')))='radegast' and public.normalize_text(coalesce(name,'')) ~ '(^| )ryze horka 12( |$)')
   or (lower(trim(coalesce(metadata->>'source_store_slug','')))='kaufland' and (public.normalize_text(coalesce(name,'')) ~ '(^| )rozprasovac na ocet a olej( |$)' or coalesce(metadata->>'kaufland_kl_nr','')='20347246'));

with target as (
  select p.id, case when public.normalize_text(p.name) ~ '(^| )mlecna ryze( |$)' then 'mlecne-vyrobky' when public.normalize_text(p.name) ~ '(^| )kvetakova ryze( |$)' then 'ovoce-zelenina' end slug
  from public.products p where p.filter_group='food' and (public.normalize_text(p.name) ~ '(^| )mlecna ryze( |$)' or public.normalize_text(p.name) ~ '(^| )kvetakova ryze( |$)')
), mapped as (
  select t.id,c.id category_id,t.slug from target t join public.categories c on c.slug=t.slug and c.is_active is true
)
update public.products p
set category_id=m.category_id,
    filter_tags=(case when m.slug='mlecne-vyrobky' then array_append(array_remove(coalesce(p.filter_tags,'{}'::text[]),'trvanlive'),'mlecne') else array_append(array_remove(coalesce(p.filter_tags,'{}'::text[]),'trvanlive'),'ovoce-zelenina') end),
    classification_source='food-subcategory-guard-v106',classification_confidence=greatest(coalesce(p.classification_confidence,0),0.999),classified_at=now(),
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard','v106','food_subcategory_guard_slug',m.slug,'food_subcategory_guard_at',now())
from mapped m where p.id=m.id and p.category_id is distinct from m.category_id;

drop function if exists public.guard_product_filter_group_false_positives_v104();
drop function if exists public.guard_safe_food_subcategory_v105();