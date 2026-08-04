create or replace function public.require_manual_product_image_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('approved','rejected','invalid') then
    reviewer := coalesce(new.reviewed_by, auth.uid());

    if new.status = 'approved' and reviewer is null then
      raise exception 'Automatické schválení fotografie není povoleno. Kandidáta musí schválit přihlášený správce.';
    end if;

    new.reviewed_by := reviewer;
    new.reviewed_at := coalesce(new.reviewed_at, now());
  elsif new.status = 'pending' then
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.rejection_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists product_image_candidates_manual_review_trigger on public.product_image_candidates;
create trigger product_image_candidates_manual_review_trigger
before update of status on public.product_image_candidates
for each row execute function public.require_manual_product_image_review();