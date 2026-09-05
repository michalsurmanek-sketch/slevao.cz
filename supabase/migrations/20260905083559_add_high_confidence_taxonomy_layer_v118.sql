create or replace function public.guard_safe_food_subcategory_v118_additions()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  v_slug text;
  v_tag text;
  v_category_id uuid;
begin
  if new.filter_group is distinct from 'food' or new.category_id is not null then return new; end if;

  if n ~ '(^| )(kralovsky bochnik globus|louhovana tasticka s klobasou a horcici|odkolek zavin s naplni makovou|trzan banketky labuznik|trzan chlebicek sunkovy)( |$)' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif n ~ '(^| )(trata salat s uzenym tunakem|uzene fi lety z makrely)( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )(manapowder origin|organis boruvky susene mrazem|maggi asia teriyaki|chio dip hot cheese|dr oetker puding|inzersdorfer pure beef sugo|kk arasidy prazene solene|mixit crunchy corn|vepy bezlepkove muslicky|vepy polstarky|vitana hrach zeleny cely|lotus pomazanka|tastino kukuricne chlebicky|havlik opal tycinky se syrem trvanlive)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(kimchi klasik palive|kimchi hot vegan cho chi)( |$)' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif n ~ '(^| )zott cremore duo chocolate( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )sweet fun sponge bob kysely zele burger( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v118';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard_addition','v118','food_subcategory_guard_addition_slug',v_slug,'food_subcategory_guard_addition_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v118_additions() from public, anon, authenticated;

drop trigger if exists zzzzzzzzzz_safe_food_subcategory_v118_additions on public.products;
create trigger zzzzzzzzzz_safe_food_subcategory_v118_additions
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v118_additions();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and p.filter_group='food' and p.category_id is null
    and (
      public.normalize_text(p.name) ~ '(^| )(kralovsky bochnik globus|louhovana tasticka s klobasou a horcici|odkolek zavin s naplni makovou|trzan banketky labuznik|trzan chlebicek sunkovy)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(trata salat s uzenym tunakem|uzene fi lety z makrely)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(manapowder origin|organis boruvky susene mrazem|maggi asia teriyaki|chio dip hot cheese|dr oetker puding|inzersdorfer pure beef sugo|kk arasidy prazene solene|mixit crunchy corn|vepy bezlepkove muslicky|vepy polstarky|vitana hrach zeleny cely|lotus pomazanka|tastino kukuricne chlebicky|havlik opal tycinky se syrem trvanlive)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(kimchi klasik palive|kimchi hot vegan cho chi)( |$)'
      or public.normalize_text(p.name) ~ '(^| )zott cremore duo chocolate( |$)'
      or public.normalize_text(p.name) ~ '(^| )sweet fun sponge bob kysely zele burger( |$)'
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v118_recheck_at',now())
from current_target t
where p.id=t.id;