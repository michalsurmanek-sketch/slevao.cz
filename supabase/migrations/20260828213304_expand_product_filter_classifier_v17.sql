-- Seventh narrow expansion: established beer/drink brands and collision-safe food identities.

create or replace function public.infer_product_filter_group_high_confidence(
  p_name text,
  p_quantity_text text default null
)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  n text := public.normalize_text(concat_ws(' ',coalesce(p_name,''),coalesce(p_quantity_text,'')));
begin
  if (n ~ '(^| )[0-9]+([.,][0-9]+)?mg( |$)'
      and n ~ '(^| )(tablet[a-z0-9]*|tobol[a-z0-9]*|kapsl[a-z0-9]*)( |$)')
     or n ~ '(^| )carbo medicinalis( |$)' then
    return 'pharmacy';
  end if;

  if n ~ '(^| )(rychlovarna konvice|varna konvice|kavovar|kavomlynek|friteza|mikrovlnna trouba|mixer|slehac|vysavac|fen|vysousec vlasu|kulma|zehlicka|televizor|reproduktor|sluchatka|epilator|elektricke struhadlo|susicka ovoce|ryzovar|kuchynsky robot)( |$)' then
    return 'electronics';
  end if;

  if n ~ '(^| )(pelmeni)( |$)'
     or n ~ '(^| )mlet[a-z0-9]* masov[a-z0-9]* smes( |$)'
     or n ~ '(^| )valassk[a-z0-9]* prsut( |$)'
     or n ~ '(^| )susene maso( |$)'
     or n ~ '(^| )(susene datle|tofu s bazalkou|rozinky thompson|krupave ovoce)( |$)'
     or n ~ '(^| )(horalky|lentilky|lindor|mentos|milka|pikao|piknik|snickers|twix|bounty|cornetto|roshen bubble|zlate polomacene|skyr|zerve|burrata|prosciutto|kashkaval)( |$)'
     or n ~ '(^| )(polevka instantni|hotove polevky|hotove jidlo|plnene knedliky|psenicna krupice|rostlinny rizek|vajecny venecek)( |$)' then
    return 'food';
  end if;

  if n ~ '(^| )klastorna kalcia( |$)'
     or n ~ '(^| )prirodni mineralni (jemne )?sycena( |$)'
     or n ~ '(^| )wiag vino( |$)' then
    return 'drinks';
  end if;

  if n ~ '(^| )(kratasy|cepice|nazouvaky|pyzamo|minisaty|pantofle|t shirt|podprsenka)( |$)'
     or n ~ '(^| )(vlozky do bot|podprsenkove vlozky|plazove obleceni)( |$)'
     or n ~ '(^| )(plavk[a-z0-9]*|bikin[a-z0-9]*)( |$)'
     or (n ~ '(^| )esmara( |$)' and n ~ '(^| )kalhotky( |$)')
     or (n ~ '(^| )horni dil( |$)' and n ~ '(^| )(plavek|plazoveho obleceni)( |$)') then
    return 'fashion';
  end if;

  if n ~ '(^| )(prosteradlo|regal|podsedak|vitrina)( |$)'
     or n ~ '(^| )nastenka korkova( |$)'
     or n ~ '(^| )omitka( |$)' then
    return 'home';
  end if;

  if (n ~ '(^| )marimex( |$)' and n ~ '(^| )(bazenova|bazenove|chlorove|plovak|sitka|teplomer|aquamar)( |$)')
     or (n ~ '(^| )gardena( |$)' and n ~ '(^| )combisystem( |$)') then
    return 'garden';
  end if;

  if n ~ '(^| )(hydrogelova maska|hydratacni textilni maska|textilni maska|pletova maska|oblicejova maska|hygienicke kapesniky|osvezovac vzduchu)( |$)'
     or n ~ '(^| )(dudlik[a-z0-9]*|savicka|kojenecka lahev|lahvicka pro kojence|detske vlhcene ubrousky|pleny)( |$)'
     or (n ~ '(^| )nuk( |$)' and n ~ '(^| )(lahev|brcko|pitko)( |$)')
     or (n ~ '(^| )philips( |$)' and n ~ '(^| )(oneblade|sonicare|brity|brit)( |$)')
     or n ~ '(^| )glade( |$)'
     or n ~ '(^| )(korektor|ocni stiny|koupel na nohy|lepidlo na nehty|naplasti na puchyre|natacky|nuzky na nehty|olej na rty|tvarenka|podkladova baze|pece na nehty|pricesek na vlasy|sada na odrosty|sada na pedikuru|sprej osvezujici na nohy|stetec na oboci|stetec na stinovani|tuzka na oci|umele rasy|umele nehty|repellent)( |$)'
     or n ~ '(^| )(tint na rty|pero na rty|tuzka na rty|maska na ruce|maska na nohy|maska na rty|naplasti pod oci)( |$)' then
    return 'drugstore';
  end if;

  if n ~ '(^| )activia( |$)' and n ~ '(^| )napoj( |$)' then
    return 'drinks';
  end if;
  if n ~ '(^| )krahulik( |$)' and n ~ '(^| )(pivo|lezak)( |$)' then
    return 'drinks';
  end if;
  if n ~ '(^| )(radegast|budweiser budvar|budvar|birell|branik|gambrinus|krusovice|velkopopovicky kozel|pardal|staropramen|ostravar)( |$)' then
    return 'drinks';
  end if;

  if n ~ '(^| )(activia|jogobella|gervais|lipanek|lucina|grand dessert|bebe dobre rano|bivoj|krahulik|chodura)( |$)' then
    return 'food';
  end if;

  if n ~ '^magnum( |$)'
     or n ~ '(^| )(schar|sedita)( |$)' then
    return 'food';
  end if;

  if n ~ '(^| )(kofola|aquila|aquilla|mattoni|ondrasovka|jihlavanka|jacobs velvet|amundsen|bozkov|becherovka|bohemia sekt|holba|zubr|litovel|regent)( |$)' then
    return 'drinks';
  end if;

  return 'other';
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to ''
as $function$ select 17; $function$;

update public.products
set name = name
where public.infer_product_filter_group_high_confidence(name,quantity_text) <> 'other'
  and (
    coalesce(nullif(trim(filter_group),''),'other')='other'
    or coalesce(metadata->>'filter_group_source','')='auto_classifier'
  );
