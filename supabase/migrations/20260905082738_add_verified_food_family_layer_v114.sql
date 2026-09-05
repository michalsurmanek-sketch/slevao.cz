create or replace function public.guard_safe_food_subcategory_v114_additions()
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

  if n ~ '(^| )(fruit rolls|bombus bio|cokoladovy preclik|marlenka bezlepkove medove kulicky|trancetto kakao|cokoladova rolka|ovocna rolka|medovy dort|gumovy medvidci|perniky glazurovane|piskoty macene v cokolade|salty toffee|cerealni tycinky)( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif n ~ '(^| )(susenkova pomazanka|good lunch|arasidovy krem|dobry hostinec|hotove jidlo hame|hame hotove jidlo|cokoladovy krem|mini cornichons|salatova zalivka|korenici smes|dresink|lucuma prasek|zazvorovy prasek|mandlovy krem)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(jemna tvaruzkova pomazanka|gastro menu express tvaruzkova pomazanka)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )k bio zelenina na masle( |$)' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;

  new.category_id:=v_category_id;
  if v_tag is not null and not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag);
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v114';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard_addition','v114','food_subcategory_guard_addition_slug',v_slug,'food_subcategory_guard_addition_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v114_additions() from public, anon, authenticated;

drop trigger if exists zzzzzzz_safe_food_subcategory_v114_additions on public.products;
create trigger zzzzzzz_safe_food_subcategory_v114_additions
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v114_additions();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and p.filter_group='food' and p.category_id is null
    and (
      public.normalize_text(p.name) ~ '(^| )(fruit rolls|bombus bio|cokoladovy preclik|marlenka bezlepkove medove kulicky|trancetto kakao|cokoladova rolka|ovocna rolka|medovy dort|gumovy medvidci|perniky glazurovane|piskoty macene v cokolade|salty toffee|cerealni tycinky)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(susenkova pomazanka|good lunch|arasidovy krem|dobry hostinec|hotove jidlo hame|hame hotove jidlo|cokoladovy krem|mini cornichons|salatova zalivka|korenici smes|dresink|lucuma prasek|zazvorovy prasek|mandlovy krem)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(jemna tvaruzkova pomazanka|gastro menu express tvaruzkova pomazanka)( |$)'
      or public.normalize_text(p.name) ~ '(^| )k bio zelenina na masle( |$)'
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v114_recheck_at',now())
from current_target t
where p.id=t.id;