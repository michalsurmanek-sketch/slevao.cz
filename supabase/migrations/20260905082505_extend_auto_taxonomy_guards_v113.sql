drop trigger if exists zzz_filter_group_false_positive_guard_v110 on public.products;
drop trigger if exists zzzzzz_safe_food_subcategory_guard_v112 on public.products;

create or replace function public.guard_product_filter_group_false_positives_v113()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(new.name,''));
  src text := lower(trim(coalesce(new.metadata->>'source_store_slug','')));
  b text := lower(trim(coalesce(new.brand,'')));
  v_category_id uuid;
  v_target_group text;
  v_target_slug text;
  v_target_tag text;
begin
  if coalesce(new.metadata->>'filter_group_source','')='explicit' then return new; end if;

  if b='herlitz' and n ~ '(^| )skolni kornout 35 cm( |$)' then
    v_target_group := 'school'; v_target_slug := null; v_target_tag := 'school';
    new.category_id := null;
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'food'),'trvanlive'),'trvanlive-potraviny');
  elsif b='banquet' and n ~ '(^| )jidlonosic plastovy apetit( |$)' then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'food'),'trvanlive'),'trvanlive-potraviny');
  elsif (b='alpro' and n ~ '(^| )napoj[a-z0-9]*( |$)')
     or n ~ '(^| )protein ovesny napoj( |$)'
     or n ~ '(^| )florian drink( |$)'
     or (b='jeden tag bio' and n ~ '(^| )citronova stava( |$)') then
    v_target_group := 'drinks'; v_target_slug := 'napoje'; v_target_tag := 'napoje';
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'food');
  elsif b='radegast' and n ~ '(^| )ryze horka 12( |$)' then
    v_target_group := 'drinks'; v_target_slug := 'napoje'; v_target_tag := 'napoje';
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'food');
  elsif src='kaufland' and (n ~ '(^| )rozprasovac na ocet a olej( |$)' or coalesce(new.metadata->>'kaufland_kl_nr','')='20347246') then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
    new.filter_tags := array_remove(array_remove(array_remove(coalesce(new.filter_tags,'{}'::text[]),'trvanlive'),'trvanlive-potraviny'),'food');
  elsif n ~ '(^| )(sendvicovac[a-z0-9]*|vaflovac[a-z0-9]*)( |$)' or n ~ '(^| )mlynek na maso( |$)' then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
  elsif ((n ~ '(^| )(trpytiva|rozjasnujici) tycinka( |$)' or n ~ '(^| )tycinka pod oci( |$)') and (b='essence' or src='dm')) then
    v_target_group := 'drugstore'; v_target_slug := 'drogerie'; v_target_tag := 'drogerie';
  elsif n ~ '(^| )vatove tycinky( |$)' or n ~ '(^| )peeling na rty( |$)' then
    v_target_group := 'drugstore'; v_target_slug := 'drogerie'; v_target_tag := 'drogerie';
  elsif src='kik' and n ~ '(^| )led lampicka( |$)' then
    v_target_group := 'home'; v_target_slug := 'domacnost'; v_target_tag := 'domacnost';
  else
    return new;
  end if;

  if v_target_slug is not null then
    select c.id into v_category_id from public.categories c where c.slug=v_target_slug and c.is_active is true limit 1;
  end if;

  new.filter_group := v_target_group;
  if v_target_slug is null then
    new.category_id := null;
  elsif v_category_id is not null then
    new.category_id := v_category_id;
  end if;
  if v_target_tag is not null and not (v_target_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then
    new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_target_tag);
  end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.999);
  new.classification_source:='false-positive-guard-v113';
  new.classified_at:=now();
  new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-'food_subcategory_guard'-'food_subcategory_guard_slug'-'food_subcategory_guard_at')
    || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_checked_at',now(),'filter_group_false_positive_guard','v113');
  return new;
end;
$function$;

revoke execute on function public.guard_product_filter_group_false_positives_v113() from public, anon, authenticated;

create trigger zzz_filter_group_false_positive_guard_v113
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_product_filter_group_false_positives_v113();

create or replace function public.guard_safe_food_subcategory_v113()
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

  if source_cat='OVOCE A ZELENINA' or (src='rohlik' and n ~ '(^| )(broskev|rukola)( |$)') or n ~ '(^| )hrozno bile bezsemenne( |$)' or n ~ '(^| )cerstvy mlady kokos drink and eat( |$)' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif src='kosik' and b='häagen-dazs' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif src='kosik' and b='max sport' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif src='kosik' and source_cat='Mléčné a chlazené' and b in ('italat','liptov','milko','mini babybel') then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(viennetta|solero|cornetto|calippo|zmrzlinova trubicka|mroz extra ovocny)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
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
  elsif (b='madeta' and n ~ '(^| )moravsky bochnik( |$)')
     or n ~ '(^| )(matylda bio syrove tycky|ehrmann grand dessert|alpro sojovy dezert|robby pudding|pudingovy se slehackou|smetanovy krem vanilka kakao)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(activia|florian smetanovy|smetanito|rama crema|zott protein|high protein puding|farmarsky tvarohovy dezert|high potein kapsicka|podmasli|margarin|slehacka ve spreji|tvarohova pomazanka|tvarohova svacinka|tvarohacek|mozzarela)( |$)' then
    v_slug:='mlecne-vyrobky'; v_tag:='mlecne';
  elsif n ~ '(^| )(rybi prsty|chapadla z kalamaru|file labuznicke|susene maso|jatrovy nakroj|sendvicovy narez|paprikas|bochanek madrid|spekacku|trampsky|kremesnik|rybi file v krupavem testicku|salat a la krab)( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )brumik( |$)' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif n ~ '(^| )(cerstve testo na pizzu|bagels|mini kobli[a-z0-9]*|sandwich rajce a bazalka|slovansky krajanek|kokosove pecivo)( |$)' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif n ~ '(^| )dr gerard trubicky( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif n ~ '(^| )(ferrero giotto|chupa chups|tartaletky malinove|minonky|kinder mlecny rez|bebe dobre rano|sondey venecky|lotus biscoff|oplatkove trubicky|cookies|susenk[a-z0-9]* merunkova|protein bar|flapjack)( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif n ~ '(^| )(milka|kit kat|kitkat|toffifee|margot|zlate venecky|choco jaffa|kinder crispy|kinder choco)( |$)' and n !~ '(^| )zmrzlina( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  elsif ((n ~ '(^| )(kesu|mandle|pistacie|orechy|orisky|dynova seminka|slunecnicova seminka|rozinky)( |$)' or n ~ '(^| )(ovoce susene mrazem|platky susene mrazem)( |$)') and n !~ '(^| )(zmrzlina|nanuk|kornout|cokolad[a-z0-9]*|bonbon[a-z0-9]*)( |$)') then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(hellmann s|heinz fazole|pecene fazole|k classic fazole|feferony|stribrite cibulky|dzem|med kvetovy|arasidy v testicku|lusteniny|nudlova polevka|mango platky susene|tahini|sezamova pasta)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(lays|lay s|goldfish bigsters|bohemia tycinky|chlebicky ryzove|chlebicky kukuricne|popcorn|krekry|tortillas)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(jedla soda|kyselina citronova|jiska|penne|tapioka perly|balsamikovy ocet|jablecny ocet|cukr trtinovy|cukr krystal|panko strouhanka|cocka|mak|kyprici prasek)( |$)' then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(testoviny|mouka|cukr|skrob|bulgur|krupice|ocet|olivy|instantni polevka|pringles|cheetos)( |$)' or (n ~ '(^| )ryze( |$)' and n !~ '(^| )(mlecna ryze|kvetakova ryze|ryze horka)( |$)') then
    v_slug:='trvanlive-potraviny'; v_tag:='trvanlive';
  elsif n ~ '(^| )(zeleninova smes|hrasek|kukurice)( |$)' then
    v_slug:='ovoce-zelenina'; v_tag:='ovoce-zelenina';
  elsif n ~ '(^| )(bagetka|listove testo|muffin|muffiny|minidonut|donut|focaccina|piadina|bulka)( |$)' then
    v_slug:='pecivo'; v_tag:='pecivo';
  elsif n ~ '(^| )(spekacky|klobasy|klobasky|sunka|salam|makrela|sardina|sardinky|sardinela|rybi filety|filety z aljasske tresky|aspikovy)( |$)' then
    v_slug:='maso-ryby'; v_tag:='maso';
  elsif n ~ '(^| )(3bit|schokobons|bonboniera|studentska pecet|halls drops|kavenky|mila)( |$)' then
    v_slug:='sladkosti'; v_tag:='sladkosti';
  else return new; end if;

  select id into v_category_id from public.categories where slug=v_slug and is_active is true limit 1;
  if v_category_id is null then return new; end if;
  new.category_id:=v_category_id;
  if v_tag is not null and not (v_tag=any(coalesce(new.filter_tags,'{}'::text[]))) then new.filter_tags:=array_append(coalesce(new.filter_tags,'{}'::text[]),v_tag); end if;
  new.classification_confidence:=greatest(coalesce(new.classification_confidence,0),0.995);
  new.classification_source:='food-subcategory-guard-v113';
  new.classified_at:=now();
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('food_subcategory_guard','v113','food_subcategory_guard_slug',v_slug,'food_subcategory_guard_at',now());
  return new;
end;
$function$;

revoke execute on function public.guard_safe_food_subcategory_v113() from public, anon, authenticated;

create trigger zzzzzz_safe_food_subcategory_guard_v113
before insert or update of name, brand, category_id, quantity_text, filter_group, metadata
on public.products
for each row execute function public.guard_safe_food_subcategory_v113();

drop function if exists public.guard_product_filter_group_false_positives_v110();
drop function if exists public.guard_safe_food_subcategory_v112();

with current_target as (
  select distinct p.id
  from public.products p
  join public.offers o on o.product_id=p.id
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and (
      (coalesce(p.filter_group,'')='food' and p.category_id is null and (
        public.normalize_text(p.name) ~ '(^| )(spekacku|trampsky|paprikas|sendvicovy narez|kremesnik|uzen[e]* filety z makrely|rybi file v krupavem testicku|salat a la krab)( |$)'
        or (lower(coalesce(p.brand,''))='madeta' and public.normalize_text(p.name) ~ '(^| )moravsky bochnik( |$)')
        or public.normalize_text(p.name) ~ '(^| )(matylda bio syrove tycky|ehrmann grand dessert|alpro sojovy dezert|robby pudding|pudingovy se slehackou|smetanovy krem vanilka kakao)( |$)'
        or public.normalize_text(p.name) ~ '(^| )(ferrero giotto|chupa chups|tartaletky malinove|minonky|kinder mlecny rez|bebe dobre rano|sondey venecky|lotus biscoff|oplatkove trubicky|cookies|susenk[a-z0-9]* merunkova|protein bar|flapjack)( |$)'
        or public.normalize_text(p.name) ~ '(^| )(hellmann s|heinz fazole|pecene fazole|k classic fazole|feferony|stribrite cibulky|dzem|med kvetovy|arasidy v testicku|lusteniny|nudlova polevka|mango platky susene|tahini|sezamova pasta)( |$)'
      ))
      or (lower(coalesce(p.brand,''))='herlitz' and public.normalize_text(p.name) ~ '(^| )skolni kornout 35 cm( |$)')
      or (lower(coalesce(p.brand,''))='banquet' and public.normalize_text(p.name) ~ '(^| )jidlonosic plastovy apetit( |$)')
    )
)
update public.products p
set metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object('current_v113_recheck_at',now())
from current_target t
where p.id=t.id;