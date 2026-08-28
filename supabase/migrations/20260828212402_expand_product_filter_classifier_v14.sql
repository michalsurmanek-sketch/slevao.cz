-- Fourth narrow expansion: clear electrical appliances, baby-care products, and bras.
-- Explicit/human classifications remain protected; only missing or auto-managed rows are re-evaluated.

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
  -- Medicines/supplements: dosage + oral dosage form must beat generic "tablet" electronics semantics.
  if (n ~ '(^| )[0-9]+([.,][0-9]+)?mg( |$)'
      and n ~ '(^| )(tablet[a-z0-9]*|tobol[a-z0-9]*|kapsl[a-z0-9]*)( |$)')
     or n ~ '(^| )carbo medicinalis( |$)' then
    return 'pharmacy';
  end if;

  -- Clear electrical appliances/devices. This also repairs auto-classified smoothie mixers misread as drinks.
  if n ~ '(^| )(rychlovarna konvice|varna konvice|kavovar|kavomlynek|friteza|mikrovlnna trouba|mixer|slehac|vysavac|fen|vysousec vlasu|kulma|zehlicka|televizor|reproduktor|sluchatka|epilator|elektricke struhadlo|susicka ovoce|ryzovar|kuchynsky robot)( |$)' then
    return 'electronics';
  end if;

  -- Existing high-confidence food identities.
  if n ~ '(^| )(pelmeni)( |$)'
     or n ~ '(^| )mlet[a-z0-9]* masov[a-z0-9]* smes( |$)'
     or n ~ '(^| )valassk[a-z0-9]* prsut( |$)'
     or n ~ '(^| )susene maso( |$)' then
    return 'food';
  end if;

  if n ~ '(^| )klastorna kalcia( |$)'
     or n ~ '(^| )prirodni mineralni (jemne )?sycena( |$)'
     or n ~ '(^| )wiag vino( |$)' then
    return 'drinks';
  end if;

  -- Recurring, unambiguous fashion product types and inflections.
  if n ~ '(^| )(kratasy|cepice|nazouvaky|pyzamo|minisaty|pantofle|t shirt|podprsenka)( |$)'
     or n ~ '(^| )(vlozky do bot|podprsenkove vlozky|plazove obleceni)( |$)'
     or n ~ '(^| )(plavk[a-z0-9]*|bikin[a-z0-9]*)( |$)' then
    return 'fashion';
  end if;

  -- Recurring household/building product types.
  if n ~ '(^| )(prosteradlo|regal|podsedak|vitrina)( |$)'
     or n ~ '(^| )nastenka korkova( |$)'
     or n ~ '(^| )omitka( |$)' then
    return 'home';
  end if;

  -- Personal-care / baby-care / household fragrance product types.
  if n ~ '(^| )(hydrogelova maska|hydratacni textilni maska|textilni maska|pletova maska|oblicejova maska|hygienicke kapesniky|osvezovac vzduchu)( |$)'
     or n ~ '(^| )(dudlik[a-z0-9]*|savicka|kojenecka lahev|lahvicka pro kojence|detske vlhcene ubrousky|pleny)( |$)'
     or n ~ '(^| )glade( |$)' then
    return 'drugstore';
  end if;

  -- Product context wins over a food brand when the item is explicitly a beverage/beer.
  if n ~ '(^| )activia( |$)' and n ~ '(^| )napoj( |$)' then
    return 'drinks';
  end if;
  if n ~ '(^| )krahulik( |$)' and n ~ '(^| )(pivo|lezak)( |$)' then
    return 'drinks';
  end if;

  -- Recurring food identities with strong historical agreement.
  if n ~ '(^| )(activia|jogobella|gervais|lipanek|lucina|grand dessert|bebe dobre rano|bivoj|krahulik|chodura)( |$)' then
    return 'food';
  end if;

  if n ~ '^magnum( |$)'
     or n ~ '(^| )(schar|sedita)( |$)' then
    return 'food';
  end if;

  -- Recurring beverage identities.
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
as $function$ select 14; $function$;

update public.products
set name = name
where public.infer_product_filter_group_high_confidence(name,quantity_text) <> 'other'
  and (
    coalesce(nullif(trim(filter_group),''),'other')='other'
    or coalesce(metadata->>'filter_group_source','')='auto_classifier'
  );
