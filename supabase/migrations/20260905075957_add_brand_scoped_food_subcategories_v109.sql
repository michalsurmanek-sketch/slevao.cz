drop trigger if exists zzzzzz_safe_food_subcategory_guard_v108 on public.products;

create or replace function public.guard_safe_food_subcategory_v109()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  source_cat text := trim(coalesce(new.metadata->>'source_category_root',new.metadata->>'source_category_path',''));
  b text := lower(trim(coalesce(new.brand,'')));
  v_slug text;
  v_tag text;
  v_category_id uuid;
begin
  if new.filter_group is distinct from 'food' or new.category_id is not null then return new; end if;

  if src='kosik' and b='häagen-dazs' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif src='kosik' and b='max sport' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='kosik' and source_cat='Mléčné a chlazené' and b in ('italat','liptov','milko','mini babybel') then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif src='penny' and source_cat='OVOCE A ZELENINA' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif n ~ '(^| )mlecna ryze( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )kvetakova ryze( |$)' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif src='kaufland' and source_cat='Maso, drůbež, uzeniny' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif src='kaufland' and source_cat='Ovoce, zelenina, rostliny' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif n ~ '(^| )(vejce|zmrzlina|nanuk|jogurt|kefir|smetana|tvaroh|tvaruzky|gervais|syrecek)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(activia|florian smetanovy|smetanito|rama crema|zott protein|high protein puding|farmarsky tvarohovy dezert|high potein kapsicka)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(rybi prsty|chapadla z kalamaru|file labuznicke)( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )dr gerard trubicky( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif ((n ~ '(^| )(kesu|mandle|pistacie|orechy|orisky|dynova seminka|slunecnicova seminka|rozinky)( |$)' or n ~ '(^| )(ovoce susene mrazem|platky susene mrazem)( |$)') and n !~ '(^| )(zmrzlina|nanuk|kornout|cokolad[a-z0-9]*|bonbon[a-z0-9]*)( |$)') then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(testoviny|mouka|cukr|skrob|bulgur|krupice|ocet|olivy|instantni polevka|pringles|cheetos)( |$)' or (n ~ '(^| )ryze( |$)' and n !~ '(^| )(mlecna ryze|kvetakova ryze|ryze horka)( |$)') then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(bagetka|listove testo|muffin|muffiny|minidonut|donut|focaccina|piadina|bulka)( |$)' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif n ~ '(^| )(spekacky|klobasy|klobasky|sunka|salam|makrela|sardina|sardinky|sardinela|rybi filety|filety z aljasske tresky|aspikovy)( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )(3bit|schokobons|bonboniera|studentska pecet|halls drops|kavenky|mila)( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  else
    return new;
  end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if v_tag is not null and not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v109';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard','v109','food_subcategory_guard_slug',v_slug,'food_subcategory_guard_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v109() from public, anon, authenticated;

create trigger zzzzzz_safe_food_subcategory_guard_v109
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v109();

drop function if exists public.guard_safe_food_subcategory_v108();