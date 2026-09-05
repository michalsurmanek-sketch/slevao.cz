insert into public.categories (name,slug,icon,description,sort_order,is_active)
values
  ('Rostlinné alternativy','rostlinne-alternativy','🌱','Tofu, rostlinné dezerty, alternativy mléčných výrobků a další rostlinné náhrady.',35,true),
  ('Lahůdky a hotová jídla','lahudky-hotova-jidla','🥗','Pomazánky, lahůdkové saláty, hotová jídla a chlazené občerstvení.',45,true),
  ('Přílohy a polotovary','prilohy-polotovary','🥔','Knedlíky, přílohy a další potravinové polotovary.',52,true),
  ('Mražené potraviny','mrazene-potraviny','❄️','Mražená jídla, pizzy, bramborové výrobky a další mražené potraviny.',55,true)
on conflict (slug) do update
set name=excluded.name,
    icon=excluded.icon,
    description=excluded.description,
    sort_order=excluded.sort_order,
    is_active=true,
    updated_at=now();

create or replace function public.guard_structural_food_categories_v122()
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

  if n ~ '(^| )(schar pizza prosciutto funghi|dr oetker pizza ristorante prosciutto|pizza ristorante|mccain golden longs|nowaco krokety|aviko super crunch julienne|fine life cesky bramborak mraz|plnene paprikove lusky s rajskou omackou mrazene)( |$)' then
    v_slug:='mrazene-potraviny'; v_tag:='mrazene';
  elsif n ~ '(^| )(lunter sojakrem|lunter tofu|ovsanek|veto eco patifu|violife blok|alpro dezert sojovy|ryzova alternativa smetany|garden gourmet vegetariansky veggie rizek|kalma dobacky)( |$)' then
    v_slug:='rostlinne-alternativy'; v_tag:='rostlinne-alternativy';
  elsif n ~ '(^| )(horazdovicke bramborove knedliky|knedlik bramborovy chlaz|knedlik jemny vitana)( |$)' then
    v_slug:='prilohy-polotovary'; v_tag:='prilohy-polotovary';
  elsif n ~ '(^| )(gasto menu salat coleslaw|hot dog s kecupem|sev[c]*ovsky mls|parkovy pikantni salat|skvarkova pomazanka|syrova pikantni pomazanka|hanacky salat|ribella hummes shitake|salat camping|svatecni bramborovy salat|cesnekova pomazanka|loupeznicky salat|pochoutkovy salat|pomazanka budapestska|salat nowaco|gastro menu express topinkova pomazanka|hame pomazanka|k classic cheeseburger|k jarmark parizsky salat|k jarmark pikantni syrova pomazanka|lakmilk hotove polevky|pajero karbanatek|authentic coleslaw salat|chef select chlebickova pomazanka|bramborovy salat|hotova jidla|nowaco pomazanka)( |$)' then
    v_slug:='lahudky-hotova-jidla'; v_tag:='lahudky';
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
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='structural-food-category-v122';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'structural_food_category','v122',
    'structural_food_category_slug',v_slug,
    'structural_food_category_at',now()
  );
  return new;
end;
$function$;

revoke execute on function public.guard_structural_food_categories_v122() from public, anon, authenticated;

drop trigger if exists zzzzzzzzzzzzzz_structural_food_categories_v122 on public.products;
create trigger zzzzzzzzzzzzzz_structural_food_categories_v122
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_structural_food_categories_v122();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and p.filter_group='food' and p.category_id is null
    and (
      public.normalize_text(p.name) ~ '(^| )(schar pizza prosciutto funghi|dr oetker pizza ristorante prosciutto|pizza ristorante|mccain golden longs|nowaco krokety|aviko super crunch julienne|fine life cesky bramborak mraz|plnene paprikove lusky s rajskou omackou mrazene)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(lunter sojakrem|lunter tofu|ovsanek|veto eco patifu|violife blok|alpro dezert sojovy|ryzova alternativa smetany|garden gourmet vegetariansky veggie rizek|kalma dobacky)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(horazdovicke bramborove knedliky|knedlik bramborovy chlaz|knedlik jemny vitana)( |$)'
      or public.normalize_text(p.name) ~ '(^| )(gasto menu salat coleslaw|hot dog s kecupem|sev[c]*ovsky mls|parkovy pikantni salat|skvarkova pomazanka|syrova pikantni pomazanka|hanacky salat|ribella hummes shitake|salat camping|svatecni bramborovy salat|cesnekova pomazanka|loupeznicky salat|pochoutkovy salat|pomazanka budapestska|salat nowaco|gastro menu express topinkova pomazanka|hame pomazanka|k classic cheeseburger|k jarmark parizsky salat|k jarmark pikantni syrova pomazanka|lakmilk hotove polevky|pajero karbanatek|authentic coleslaw salat|chef select chlebickova pomazanka|bramborovy salat|hotova jidla|nowaco pomazanka)( |$)'
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v122_recheck_at',now())
from current_target t
where p.id=t.id;
