insert into public.categories (name, slug, icon, sort_order, is_active)
select 'Dětská výživa', 'detska-vyziva', '🍼', 75, true
where not exists (
  select 1 from public.categories where slug='detska-vyziva'
);

update public.categories
set name='Rostlinné a vegan produkty',
    icon=coalesce(icon,'🌱'),
    updated_at=now()
where slug='rostlinne-alternativy';

create or replace function public.guard_safe_food_subcategory_v123_final_exact()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  v_slug text;
  v_tag text;
  v_category_id uuid;
begin
  if new.filter_group is distinct from 'food' or new.category_id is not null then
    return new;
  end if;

  case n
    when 'boruvkovy dezert' then v_slug:='rostlinne-alternativy'; v_tag:='rostlinne-alternativy';
    when 'dezert ve spreji' then v_slug:='mlecne-vyrobky'; v_tag:='mlecne-vyrobky';
    when 'dita' then v_slug:='sladkosti'; v_tag:='sladkosti';
    when 'bonne maman ovocne dezerty 2x130g jahoda' then v_slug:='trvanlive-potraviny'; v_tag:='trvanlive-potraviny';
    when 'fermentik ruzne prichute 150g' then v_slug:='rostlinne-alternativy'; v_tag:='rostlinne-alternativy';
    when 'semix zapekane tycinky naslano s prichuti kimchi bez lepku 55g' then v_slug:='trvanlive-potraviny'; v_tag:='trvanlive-potraviny';
    when 'zlate 140 150 g' then v_slug:='sladkosti'; v_tag:='sladkosti';
    when 'bio slunicko' then v_slug:='pecivo'; v_tag:='pecivo';
    when 'kgold tiramisu' then v_slug:='lahudky-hotova-jidla'; v_tag:='lahudky';
    when 'machland bio ovocna dren' then v_slug:='trvanlive-potraviny'; v_tag:='trvanlive-potraviny';
    when 'tastino vilma proteinova' then v_slug:='sladkosti'; v_tag:='sladkosti';
    when 'alibona brusinky 8 x 270 g' then v_slug:='trvanlive-potraviny'; v_tag:='trvanlive-potraviny';
    when 'bio bataty dyne a jablko 120 g' then v_slug:='detska-vyziva'; v_tag:='detska-vyziva';
    else return new;
  end case;

  select id into v_category_id
  from public.categories
  where slug=v_slug and is_active is true
  limit 1;

  if v_category_id is null then
    return new;
  end if;

  new.category_id:=v_category_id;
  if not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag);
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='verified-exact-food-guard-v123';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'verified_exact_food_category','v123',
    'verified_exact_food_category_slug',v_slug,
    'verified_exact_food_category_at',now()
  );
  return new;
end;
$function$;

revoke all on function public.guard_safe_food_subcategory_v123_final_exact() from public, anon, authenticated;

drop trigger if exists zzzzzzzzzzzzzzz_safe_food_v123 on public.products;
create trigger zzzzzzzzzzzzzzz_safe_food_v123
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v123_final_exact();

update public.products
set name=name
where is_active=true
  and filter_group='food'
  and category_id is null
  and public.normalize_text(coalesce(name,'')) in (
    'boruvkovy dezert',
    'dezert ve spreji',
    'dita',
    'bonne maman ovocne dezerty 2x130g jahoda',
    'fermentik ruzne prichute 150g',
    'semix zapekane tycinky naslano s prichuti kimchi bez lepku 55g',
    'zlate 140 150 g',
    'bio slunicko',
    'kgold tiramisu',
    'machland bio ovocna dren',
    'tastino vilma proteinova',
    'alibona brusinky 8 x 270 g',
    'bio bataty dyne a jablko 120 g'
  );
