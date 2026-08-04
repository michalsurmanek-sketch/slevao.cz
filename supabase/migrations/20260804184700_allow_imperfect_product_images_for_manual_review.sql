create or replace function public.balance_product_image_candidate_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  review jsonb;
  package_match boolean;
  product_match boolean;
  front_ok boolean;
  has_hands boolean;
  back_label boolean;
  price_overlay boolean;
  text_dominant boolean;
  visual_quality integer;
  visual_confidence numeric;
  effective_match boolean;
begin
  review := new.metadata -> 'visual_validation';

  if new.status <> 'invalid' or review is null then
    return new;
  end if;

  product_match := coalesce((review ->> 'product_matches')::boolean, false);
  front_ok := coalesce((review ->> 'front_or_catalog_view')::boolean, false);
  has_hands := coalesce((review ->> 'hands_or_people')::boolean, false);
  back_label := coalesce((review ->> 'back_label_dominant')::boolean, false);
  price_overlay := coalesce((review ->> 'price_or_promo_overlay')::boolean, false);
  text_dominant := coalesce((review ->> 'text_dominant')::boolean, false);
  visual_quality := coalesce((review ->> 'quality_score')::integer, 0);
  visual_confidence := coalesce((review ->> 'confidence')::numeric, 0);

  package_match := case
    when review ? 'package_quantity_matches'
      and review ->> 'package_quantity_matches' is not null
      then (review ->> 'package_quantity_matches')::boolean
    else null
  end;

  effective_match := product_match or package_match is true;

  if effective_match
    and front_ok
    and package_match is not false
    and not has_hands
    and not back_label
    and not text_dominant
    and visual_quality >= 5
    and visual_confidence >= 0.65
  then
    new.status := 'pending';
    new.rejection_reason := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.metadata := jsonb_set(
      coalesce(new.metadata, '{}'::jsonb),
      '{review_tier}',
      to_jsonb(case
        when product_match
          and coalesce((review ->> 'clean_background')::boolean, false)
          and not coalesce((review ->> 'shelf_or_scene')::boolean, false)
          and not price_overlay
          and visual_quality >= 74
          and visual_confidence >= 0.82
          then 'clean'
        else 'usable_manual'
      end),
      true
    );
  end if;

  return new;
end;
$$;