create or replace function public.guard_safe_food_subcategory_v119_verified_exact()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  v_slug text;
  v_tag text;
  v_category_id uuid;
begin
  if new.filter_group is distinct from 'food' or new.category_id is not null then return new; end if;

  if src='globus' and n='arizonky 60g' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='pilulka' and n='andelska vajicka 240 g' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='pilulka' and n in ('bio tuba dezert s kokosem vegan 45 g','liskoorechovy krem super smooth 220 g') then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='kosik' and n='george and stephen mr lime' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='kosik' and n in ('big boy r arasidovy krupavy','big boy r grand zero s bilou cokoladou','big boy r grand zero s mlecnou cokoladou') then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='verified-exact-food-guard-v119';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('verified_exact_food_guard','v119','verified_exact_food_guard_slug',v_slug,'verified_exact_food_guard_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v119_verified_exact() from public, anon, authenticated;

drop trigger if exists zzzzzzzzzzz_safe_food_subcategory_v119_verified_exact on public.products;
create trigger zzzzzzzzzzz_safe_food_subcategory_v119_verified_exact
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v119_verified_exact();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  join public.stores s on s.id=o.store_id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and p.filter_group='food' and p.category_id is null
    and (
      (s.slug='globus' and public.normalize_text(p.name)='arizonky 60g')
      or (s.slug='pilulka' and public.normalize_text(p.name) in ('andelska vajicka 240 g','bio tuba dezert s kokosem vegan 45 g','liskoorechovy krem super smooth 220 g'))
      or (s.slug='kosik' and public.normalize_text(p.name) in ('george and stephen mr lime','big boy r arasidovy krupavy','big boy r grand zero s bilou cokoladou','big boy r grand zero s mlecnou cokoladou'))
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v119_recheck_at',now())
from current_target t
where p.id=t.id;