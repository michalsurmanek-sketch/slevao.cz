create or replace function public.guard_safe_food_subcategory_v120_exact()
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

  if src='globus' and n='koren s olivami 240g' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif src='globus' and n='mamma gnochi 500g' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='globus' and n='verbena sipek 60g' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='hruska' and n='babicciny valcovane 330 g' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif src='kaufland' and n='jahodove srdce' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif src='kosik' and n='sufan mandlove palacinky' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  else
    return new;
  end if;

  select id into v_category_id
  from public.categories
  where slug=v_slug and is_active is true
  limit 1;
  if v_category_id is null then return new; end if;

  new.category_id:=v_category_id;
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag);
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='verified-exact-food-guard-v120';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'verified_exact_food_guard','v120',
    'verified_exact_food_guard_slug',v_slug,
    'verified_exact_food_guard_at',now()
  );
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v120_exact() from public, anon, authenticated;

drop trigger if exists zzzzzzzzzzzz_safe_food_subcategory_v120_exact on public.products;
create trigger zzzzzzzzzzzz_safe_food_subcategory_v120_exact
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v120_exact();

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
      (s.slug='globus' and public.normalize_text(p.name) in ('koren s olivami 240g','mamma gnochi 500g','verbena sipek 60g'))
      or (s.slug='hruska' and public.normalize_text(p.name)='babicciny valcovane 330 g')
      or (s.slug='kaufland' and public.normalize_text(p.name)='jahodove srdce')
      or (s.slug='kosik' and public.normalize_text(p.name)='sufan mandlove palacinky')
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v120_recheck_at',now())
from current_target t
where p.id=t.id;