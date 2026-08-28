-- Extend only high-confidence public filter classifications observed in current published offers.
-- Explicit/human groups remain protected by auto_assign_product_filter_group().

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
  -- Existing high-confidence v10 identities.
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

  -- v11: recurring, unambiguous fashion product types.
  if n ~ '(^| )(kratasy|cepice|nazouvaky|pyzamo|minisaty)( |$)' then
    return 'fashion';
  end if;

  -- v11: recurring household product types. Avoid generic "doza" because pet/food containers collide.
  if n ~ '(^| )(prosteradlo|regal|podsedak|vitrina)( |$)'
     or n ~ '(^| )nastenka korkova( |$)' then
    return 'home';
  end if;

  -- v11: product context wins over a food brand when the item is explicitly a beverage/beer.
  if n ~ '(^| )activia( |$)' and n ~ '(^| )napoj( |$)' then
    return 'drinks';
  end if;
  if n ~ '(^| )krahulik( |$)' and n ~ '(^| )(pivo|lezak)( |$)' then
    return 'drinks';
  end if;

  -- v11: recurring food identities with strong historical agreement.
  if n ~ '(^| )(activia|jogobella|gervais|lipanek|lucina|grand dessert|bebe dobre rano|bivoj|krahulik|chodura)( |$)' then
    return 'food';
  end if;

  -- v11: recurring beverage identities. Keep these narrower than generic brand families.
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
as $function$ select 11; $function$;

-- Re-run only products newly covered by v11 and only when the group is missing/auto-managed.
update public.products
set name = name
where public.infer_product_filter_group_high_confidence(name,quantity_text) <> 'other'
  and (
    coalesce(nullif(trim(filter_group),''),'other')='other'
    or coalesce(metadata->>'filter_group_source','')='auto_classifier'
  );
