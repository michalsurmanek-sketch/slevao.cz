create or replace function public.infer_product_filter_group_v23(
  p_name text,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,'')));
  v_source_store text := lower(coalesce(p_metadata->>'source_store_slug',''));
begin
  if v_source_store='kosik' then
    if n ~ '(^| )(grapefruit cerveny|lahudkove drozdi|arasidovy krupavy|salty toffee|vruby solene|fruit gummies|protein fit|hrasek|lneny olej|kvasek na pizzu|cokobananek|cornichons|penne bez lepku|milk chocolate figurine|chupa chups|smes venecky|mixed pickles|sprej bov ochuceny|pomelo kostky|giotto|traubenzucker lizatka|rolada cappuccino|mr lime|pocky cookies|kroupy jecmenne|feta pdo|rozinky zlate|karamel|hurvinkuv kepuc|z tvarohu a smetany|pan meal|protein bar|merci lovelies|merci together|mini babybel|nerds fruits|slovansky krajanek|nudlova polevka|papita choppy|podravka kren|president rondele|mleta smes krutiho masa|dark salted almond|tortilly|smetanove giga|ketchup master|mandlove palacinky|tahini|mangova povidla|bezlepkove muslicky|hrach zeleny|kokosovy raw olej|monte mega|casino mini cornichons)( |$)' then return 'food'; end if;
    if n ~ '(^| )(derma expert 2 step mask|elmex kids set|vlhcene antibakterialni ubrousky|pena do koupele|pasky na prani|kapesniky 3 vrstve|kapesniky 3vrstve|easy clean scrubber)( |$)' then return 'drugstore'; end if;
    if n ~ '(^| )(pudni vitaminy|stitky zapichovaci)( |$)' then return 'garden'; end if;
    if n ~ '(^| )varta longlife max power c( |$)' then return 'electronics'; end if;
    if n ~ '(^| )sunkovar( |$)' then return 'home'; end if;
  end if;

  if v_source_store='globus' then
    if n ~ '(^| )(barvy temperove tempus|bobo plastic blok|elisa sesit|herlitz obal prosp|oxford batoh ox school|oxford pouzdro etue|oxy pastelini|paper factory sesit|ses 525 e ecology|minecraft blok a6|kelimek na vodu s bezpecnostnim uzaverem)( |$)'
       or (n ~ '(^| )oxybag( |$)' and n ~ '(^| )(etue|pouzdro|skolni|sesit)( |$)') then return 'school'; end if;
    if n ~ '(^| )(krajec potravin|varta longlife aa|chytre bryle|elektricke klavesy|dab fm buetooth radio|dvouzilovy pohyblivy privod|led reflektor|stolni lampa|domaci pekarna|kuchynska vaha|svarecka folii|topinkovac|zehlici system|napenovac eta|rucni naparovac odevu|multifunkce smart tank|susicka potravin|elektroskutr|elektricka kolobezka|t mobile sim karta|sada predniho a zadniho svetla)( |$)' then return 'electronics'; end if;
    if n ~ '(^| )(bohemia cerstve sklizeno|emco myslik|haagen dazs|mars 51 g|merci finest selection|orion granko|teekanne garden selection|vas vyber kralovska smes|vas vyber studentska smes|davidoff expresso kapsle)( |$)' then return 'food'; end if;
    if n ~ '(^| )(rohozka wonderful|fino hd pytle|box ulozny s vikem|ubrousky bile|mikrohadricik colors|yankee candle home inspiration)( |$)' then return 'home'; end if;
    if n ~ '(^| )(dove advanced antistress|menstruacni kalhotky)( |$)' then return 'drugstore'; end if;
  end if;

  if v_source_store='hruska' then
    if n ~ '(^| )(deli 35 g|eduscho|lina 50 g|pedro kysele duhove pasky|rama 400 g|razenka|rolka maslova cokoladova|rychla vecere vitana|tobogan 80 ml|vahala bratislavske|zatkovy vajecne)( |$)' then return 'food'; end if;
    if n ~ '(^| )(guarana 0 5 l|mucha cocktails|rajec 321|tiger 0 5 l)( |$)' then return 'drinks'; end if;
    if n ~ '(^| )(carin ultra wings|jar jar 900 ml)( |$)' then return 'drugstore'; end if;
  end if;

  if v_source_store='flop' and n ~ '(^| )(blatacke zlato|ceske buchticky|dr halir|peprenky|jc lipno|lacki dammer|sevcovsky mls|lovita jelly cookies|milk burger|pedro kysele duhove pasky|perla vybrane druhy|primator 140 g|snek bob|spicka s naplni|super ovoce 100|vesna vybrane druhy|zitno psenicna kostka)( |$)' then return 'food'; end if;

  if v_source_store='norma' then
    if n ~ '(^| )(aspikovy ctyrlistek|bruschetta 70 g|houbova smes|mila rezy|pat mat 80 g|recke speciality)( |$)' then return 'food'; end if;
    if n ~ '(^| )(jedenactka 0 5 l|neperliva 1 5 l)( |$)' then return 'drinks'; end if;
  end if;

  if v_source_store='rohlik' then
    if n ~ '(^| )(hellmann s yofresh|kucharsky box|semix ovsane k visen)( |$)' then return 'food'; end if;
    if n ~ '(^| )(cvikov klic 12 pet|stern sierra ipa 14 plech)( |$)' then return 'drinks'; end if;
  end if;

  if v_source_store='kaufland' then
    if n ~ '(^| )(leiffheit mop|leiffheit podlahovy mop|leiffheit sterka|lavice s uloznym prostorem|led nastenne a stolni hodiny|stolni led lampa|stropni led svetlo|kovovy trezor|skladaci stolicka|w5 koste|w5 mop|nahradni potah na mop)( |$)' then return 'home'; end if;
    if n ~ '(^| )(guma tuzka|papirove desky s gumickou|stitch samolepky)( |$)' then return 'school'; end if;
    if n ~ '(^| )(switch on baterie|switch on popkornovac|hyundai rucni naparovac)( |$)' then return 'electronics'; end if;
  end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 23 $$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_inferred text;
  v_version integer := public.product_filter_group_classifier_version();
  v_old_auto boolean := false;
  v_new_auto boolean := false;
  v_explicit_change boolean := false;
begin
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';

  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;

  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version')
      || jsonb_build_object(
        'filter_group_source','explicit',
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text);
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_v23(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);
    end if;

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object(
          'filter_group_source','auto_classifier',
          'filter_group_classifier_version',v_version
        );
      end if;
    end if;
  end if;

  return new;
end;
$function$;
