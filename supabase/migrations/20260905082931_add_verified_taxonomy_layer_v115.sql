create or replace function public.guard_filter_group_v115_additions()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  b text := lower(trim(coalesce(new.brand,'')));
  v_category_id uuid;
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then return new; end if;
  if new.filter_group is distinct from 'food' then return new; end if;

  if (b='mana' and n ~ '(^| )manadrink( |$)')
     or (b='vina tarapaca' and n ~ '(^| )syrah( |$)') then
    select id into v_category_id from public.categories where slug='napoje' and is_active is true limit 1;
    new.filter_group:='drinks';
    if v_category_id is not null then new.category_id:=v_category_id; end if;
    new.filter_tags:=array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'food'),'trvanlive'),'trvanlive-potraviny');
    if not ('napoje'=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),'napoje'); end if;
    new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
    new.classification_source:='filter-group-guard-v115';
    new.classified_at:=now();
    new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-'food_subcategory_guard'-'food_subcategory_guard_slug'-'food_subcategory_guard_at')||jsonb_build_object('filter_group_source','auto_classifier','filter_group_guard','v115','filter_group_guard_at',now());
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_filter_group_v115_additions() from public, anon, authenticated;

drop trigger if exists zzzzz_filter_group_v115_additions on public.products;
create trigger zzzzz_filter_group_v115_additions
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_filter_group_v115_additions();

create or replace function public.guard_safe_food_subcategory_v115_additions()
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

  if n ~ '(^| )(milko tolstejn|president rondele|madeta jihoceske ab|krajanka sametovy dezert|perla papricky plnene syrem|flora|perla tip|omega 100 rostlinny tuk|super creme bonjour original|cavalier tvarohovy|valsoia pudink|valsoia kesu kornout|oreo sandwich|prima vanilkova prichut|cametti jahoda)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(sledove prstynky|morska stika|matjesy|sledovy salat|zavinace|uzen[e]* filety z makrely|ponnath videnske miniparecky|kmotr duo)( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )(kinder chocolate maxi|sedita lina|vendy cokoladova|merci together|nerds fruits|red band tutti frutti)( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif n ~ '(^| )(cukrarske zele|dr oetker smes venecky|master martini poleva|master martini tmave kapicky|kroupy jecmenne|bananove platky|fazole mungo|kokos strouhany|lusteninova smes|lagris soja|houboveho kubu susena|maggi pan meal|mixed pickles|kren|papri chup|granola|krehke platky kukuricne|brusinkovy kren|kuskus|kotanyi koreni|prisada do jidel|maggi napady|variva polevka|bzenecky ocet|krupicka jemna)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v115';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard_addition','v115','food_subcategory_guard_addition_slug',v_slug,'food_subcategory_guard_addition_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v115_additions() from public, anon, authenticated;

drop trigger if exists zzzzzzzz_safe_food_subcategory_v115_additions on public.products;
create trigger zzzzzzzz_safe_food_subcategory_v115_additions
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v115_additions();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and (
      (p.filter_group='food' and ((lower(trim(coalesce(p.brand,'')))='mana' and public.normalize_text(p.name) ~ '(^| )manadrink( |$)') or (lower(trim(coalesce(p.brand,'')))='vina tarapaca' and public.normalize_text(p.name) ~ '(^| )syrah( |$)')))
      or (p.filter_group='food' and p.category_id is null and (
        public.normalize_text(p.name) ~ '(^| )(milko tolstejn|president rondele|madeta jihoceske ab|krajanka sametovy dezert|perla papricky plnene syrem|flora|perla tip|omega 100 rostlinny tuk|super creme bonjour original|cavalier tvarohovy|valsoia pudink|valsoia kesu kornout|oreo sandwich|prima vanilkova prichut|cametti jahoda)( |$)'
        or public.normalize_text(p.name) ~ '(^| )(sledove prstynky|morska stika|matjesy|sledovy salat|zavinace|uzen[e]* filety z makrely|ponnath videnske miniparecky|kmotr duo)( |$)'
        or public.normalize_text(p.name) ~ '(^| )(kinder chocolate maxi|sedita lina|vendy cokoladova|merci together|nerds fruits|red band tutti frutti)( |$)'
        or public.normalize_text(p.name) ~ '(^| )(cukrarske zele|dr oetker smes venecky|master martini poleva|master martini tmave kapicky|kroupy jecmenne|bananove platky|fazole mungo|kokos strouhany|lusteninova smes|lagris soja|houboveho kubu susena|maggi pan meal|mixed pickles|kren|papri chup|granola|krehke platky kukuricne|brusinkovy kren|kuskus|kotanyi koreni|prisada do jidel|maggi napady|variva polevka|bzenecky ocet|krupicka jemna)( |$)'
      ))
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v115_recheck_at',now())
from current_target t
where p.id=t.id;