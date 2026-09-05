create or replace function public.guard_safe_food_subcategory_v116_additions()
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

  if n ~ '(^| )(alnatura bio cukr zelirovaci|big boy arasidovy krupavy|bonitas bio smes orechu a ovoce|caputo criscito di casa kvasek na pizzu|alnatura bio pomazanka liskooriskova s kakaem|casino cokoladovo oriskova pomazanka|casino delices pomazanka ze susenych rajcat|fabio sprej bov ochuceny|farmland pomelo kostky|farmland svacinka studentska smes|oyakata instantni nudlova ramen polevka|biopekarna zemanka bio bezlepkove tycinky solene|kim master morske rasy wasabi|racio silouette cockove|semix petizrnne chlebicky|bio spaldove hvezdicky|malina krupave ovoce|nocciolata bio crunchy liskooriskova pomazanka)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(dort slehackovy harlekyn|orion deli pistaciova|sedita seditky mini piskoty|farmland arasidove hrudky|farmland kesu hrudky|fine life mandle v mlecne cokolade)( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif n ~ '(^| )rio mare pate tunakove( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v116';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard_addition','v116','food_subcategory_guard_addition_slug',v_slug,'food_subcategory_guard_addition_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v116_additions() from public, anon, authenticated;

drop trigger if exists zzzzzzzzz_safe_food_subcategory_v116_additions on public.products;
create trigger zzzzzzzzz_safe_food_subcategory_v116_additions
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v116_additions();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and p.filter_group='food' and p.category_id is null
    and (
      public.normalize_text(p.name) ~ '(^| )(alnatura bio cukr zelirovaci|big boy arasidovy krupavy|bonitas bio smes orechu a ovoce|caputo criscito di casa kvasek na pizzu|alnatura bio pomazanka liskooriskova s kakaem|casino cokoladovo oriskova pomazanka|casino delices pomazanka ze susenych rajcat|fabio sprej bov ochuceny|farmland pomelo kostky|farmland svacinka studentska smes|oyakata instantni nudlova ramen polevka|biopekarna zemanka bio bezlepkove tycinky solene|kim master morske rasy wasabi|racio silouette cockove|semix petizrnne chlebicky|bio spaldove hvezdicky|malina krupave ovoce|nocciolata bio crunchy liskooriskova pomazanka)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(dort slehackovy harlekyn|orion deli pistaciova|sedita seditky mini piskoty|farmland arasidove hrudky|farmland kesu hrudky|fine life mandle v mlecne cokolade)( |$)'
      or public.normalize_text(p.name) ~ '(^| )rio mare pate tunakove( |$)'
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v116_recheck_at',now())
from current_target t
where p.id=t.id;