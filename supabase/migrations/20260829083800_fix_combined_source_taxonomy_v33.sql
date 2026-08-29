-- Prevent a combined category root such as "Potraviny, nápoje" from matching
-- its own word "nápoje". Classification uses the official hierarchy below the root.

create or replace function public.infer_product_filter_group_source_category_v33(
  p_store_slug text,
  p_category_root text,
  p_category_path text
)
returns text
language plpgsql
stable
parallel safe
set search_path to 'public','pg_temp'
as $$
declare
  v_store text := lower(trim(coalesce(p_store_slug,'')));
  v_root text := public.normalize_text(coalesce(p_category_root,''));
  v_path text := public.normalize_text(coalesce(p_category_path,''));
  v_tail text;
begin
  if v_root='' then return 'other'; end if;
  v_tail := case when left(v_path,length(v_root))=v_root then btrim(substr(v_path,length(v_root)+1)) else v_path end;

  if v_root ~ '^(potraviny|jidlo)$' then return 'food'; end if;
  if v_root ~ '^(napoje|nealkoholicke napoje)$' then return 'drinks'; end if;
  if v_root ~ '^(kosmetika|drogerie|hygiena|ustni hygiena)$' then return 'drugstore'; end if;
  if v_root ~ '^(veterina|chovatelske potreby|potreby pro zvirata)$' then return 'pets'; end if;
  if v_root ~ '^(vitaminy a mineraly|vitaminy mineralni latky a elektrolyty|doplnky stravy|leky|leciva|zdravi|zdravi a leky|zdravotnicke potreby|zdravotnicke prostredky|homeopatie)$' then return 'pharmacy'; end if;

  if v_store='pilulka' and v_root='potraviny napoje' then
    if v_tail ~ '^(caje|kava|napoje)( |$)' then return 'drinks'; end if;
    return 'food';
  end if;

  if v_store='pilulka' and v_root in ('maminky a deti','deti a maminky') then
    if v_tail ~ '(^| )(detske napoje|napoje pro deti|detske caje|caje pro deti|detske stavy|stavy pro deti)( |$)' then return 'drinks'; end if;
    if v_tail ~ '(^| )(detske kapsicky|detske prikrmy|prikrmy|presnidavky|kapsicky|detske kase|mlecne kase|kojenecka mleka|pocatecni mleka|pokracovaci mleka|detska vyziva|potraviny pro deti|susenky a krupky pro deti)( |$)' then return 'food'; end if;
    if v_tail ~ '(^| )(pleny|prebalovani|vlhcene ubrousky|detska kosmetika|detska hygiena|koupani deti)( |$)' then return 'drugstore'; end if;
    if v_tail ~ '(^| )(vitaminy pro deti|doplnky stravy pro deti|vitaminy pro tehotne|doplnky pro tehotne)( |$)' then return 'pharmacy'; end if;
  end if;

  if v_store='pilulka' and v_root='sport' and v_tail ~ '(^| )(gainery|sportovni vyziva|sportovni vykon a regenerace)( |$)' then return 'pharmacy'; end if;
  return 'other';
end;
$$;
