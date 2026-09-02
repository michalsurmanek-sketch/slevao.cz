create or replace function public.infer_product_filter_group_kaufland_context_v39(p_name text, p_category_root text)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(coalesce(p_name,''));
  c text := public.normalize_text(coalesce(p_category_root,''));
begin
  if c like 'spotrebni zbozi%' then
    if n ~ '(^| )tester automobilovych obvodu( |$)' then return 'auto'; end if;
    if n ~ '(^| )(denik|pero|guma|gumy|spiralovy blok|tuzka|tuzky|ukoly|sesit|predskolak|karticky s aktivitami|kniha pro tvoreni|samolepky|abeceda|matematiky|psani|kreslici blok|belitko|rychlovazace|pracovni sesit|cvicebnice)( |$)'
       or n ~ 'kancelarsk.*potreb|samolepkova knizka|magnetu cisla|sada stetcu' then return 'school'; end if;
    if n ~ '(^| )(houpacka|rodinna hra|pexeso|puzzle|plysova hracka|plysak)( |$)' or n ~ 'stan na hrani' then return 'toys'; end if;
    if n ~ '(^| )(kalhotky|sandaly)( |$)' then return 'fashion'; end if;
    if n ~ 'power banka|tester sitovych kabelu' then return 'electronics'; end if;
    if n ~ 'sportovni taska' then return 'sports'; end if;
    if n ~ '(^| )(aku|sponkovacka|sroubovak|vrtacka|kladivo|bruska|kompresor|utahovak|vrtaky|schudky)( |$)'
       or n ~ 'primocara pila|retezova pila|brusna stanice|pajeci stanice|hrubovacich kotoucu|piskovaci pistole|tavna lepici pistole|krimpovaci kleste|krizovy laser|nastrcnych klicu|nuzek na plech|suchou vystavbu|zkousecka napeti|protiprachova folie|krycich folii|krycich plachet|prepravu nabytku|zpracovani silikonu|akumulatoru|lepici tycinky|stupnovite vrtaky|forstnerovy vrtaky|frezove vrtaky|cepove vrtaky|multifunkcni vrtaky|vrtaky se zahlubniky|malirska startovaci sada'
       or n ~ 'filtracni konvice|filtracnich patron|odvapnovac|vodni fitr|vodni filtr|rendlik|nadoba na obed|termoska|wc sedatko|nocnik|stolicka|kuchynska vaha|sada hrncu|sekacek potravin|topinkovac|nakupni taska na koleckach' then return 'home'; end if;
  end if;
  if c like 'mimoradna nabidka%' then
    if n ~ 'koupel|deospray|gel na holeni|holici strojek|intimni gel|intimni ubrousky|maska na oblicej|pece o rty' then return 'drugstore'; end if;
    if n ~ '(^| )stava( |$)' then return 'drinks'; end if;
    if n ~ 'lusteniny|strouhanka|mozzarela|zelenina|spaghetti|ovocna dren|slehacka' then return 'food'; end if;
  end if;
  if c='drogerie detska vyziva a pece krmiva' then
    if n ~ '(^| )(pochoutka|krmivo|krmiva)( |$)' then return 'pets'; end if;
    if n ~ 'vonne perly|kryti sedin|barva na vlasy|tampax|gel na skvrny|proti plisnim' then return 'drugstore'; end if;
    if n ~ 'alobal|potravinova folie|sacky mikrotenove' then return 'home'; end if;
  end if;
  if c='kava caj cukrovinky slane pochoutky' then
    if n ~ 'kakao|kavovinova smes|(^| )kava( |$)|(^| )caj( |$)' then return 'drinks'; end if;
    if n ~ 'lizatko|trubicky|drops|zvykacky|bonboniera' then return 'food'; end if;
  end if;
  if c='ovoce zelenina rostliny' then
    if n ~ '(^| )(most|stava)( |$)' then return 'drinks'; end if;
    if n ~ 'konifery|(^| )(rostlina|rostliny|kvetina|kvetiny|vres)( |$)' then return 'garden'; end if;
    if n ~ '(^| )(blumy|dyne|nashi)( |$)' then return 'food'; end if;
  end if;
  if c like 'xtra %' then
    if n ~ 'parfem na prani' then return 'drugstore'; end if;
    if n ~ '(^| )stava( |$)' then return 'drinks'; end if;
    if n ~ 'hrasek|gumovy medvidci|perniky' then return 'food'; end if;
  end if;
  if c ~ '^[0-9]{2} [0-9]{2} 20[0-9]{2}' then
    if n ~ 'intimni gel' then return 'drugstore'; end if;
    if n ~ 'chocolate|(^| )sul( |$)|drozdi' then return 'food'; end if;
  end if;
  if c='odevy auto volny cas hry' and n ~ 'stan na hrani' then return 'toys'; end if;
  if c='elektro kancelar media' and n ~ '(^| )baterie( |$)' then return 'electronics'; end if;
  if c like 'kxtra %' and n ~ '(^| )zebrik( |$)' then return 'home'; end if;
  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 39 $function$;

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
  v_source_category boolean := false;
  v_kaufland_context boolean := false;
  v_source_store text;
  v_source_root text;
  v_source_path text;
begin
  if coalesce(new.metadata->>'created_from_kaufland_ssr','false')='true'
     and nullif(trim(new.metadata->>'kaufland_category'),'') is not null
     and nullif(trim(new.metadata->>'source_category_root'),'') is null
     and coalesce(nullif(trim(new.metadata->>'source_store_slug'),''),'kaufland')='kaufland' then
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_store_slug','kaufland',
      'source_category_root',new.metadata->>'kaufland_category',
      'source_category_path',new.metadata->>'kaufland_category',
      'source_category_items',jsonb_build_array(new.metadata->>'kaufland_category'),
      'source_category_source','kaufland-ssr-category-v1'
    );
  end if;
  v_source_store := new.metadata->>'source_store_slug';
  v_source_root := new.metadata->>'source_category_root';
  v_source_path := new.metadata->>'source_category_path';
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';
  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;
  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version') || jsonb_build_object('filter_group_source','explicit','filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
    return new;
  end if;
  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_source_category_v37(v_source_store,v_source_root,v_source_path);
    v_source_category := v_inferred <> 'other';
    if v_inferred='other' and lower(trim(coalesce(v_source_store,'')))='kaufland' then
      v_inferred := public.infer_product_filter_group_kaufland_context_v39(new.name,v_source_root);
      v_kaufland_context := v_inferred <> 'other';
    end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_source_rules_v33(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata); end if;
    if v_inferred='other' then v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata); end if;
    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      if v_source_category then new.classification_source := 'source-category-v39';
      elsif v_kaufland_context then new.classification_source := 'kaufland-context-v39';
      elsif public.infer_product_filter_group_gap_v34(new.name,new.quantity_text,new.metadata) <> 'other' then new.classification_source := 'gap-rules-v34';
      end if;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_version',v_version,'filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('filter_group_classifier_checked_version',v_version,'filter_group_classifier_checked_at',now());
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object('filter_group_source','auto_classifier','filter_group_classifier_version',v_version);
      end if;
    end if;
  end if;
  return new;
end;
$function$;