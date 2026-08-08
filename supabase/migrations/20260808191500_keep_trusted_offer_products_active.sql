-- A trusted published offer must never point at an inactive product.
-- This also covers the race/unique-violation path where a publisher reuses an older
-- quarantined product after failing to insert a duplicate canonical product.

create or replace function public.ensure_trusted_offer_product_active()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if new.product_id is not null
     and new.status='published'
     and new.is_verified is true
     and coalesce(new.confidence_score,0)>=0.90 then
    update public.products
    set is_active=true,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          '_reactivated_by_trusted_offer_at',now(),
          '_reactivated_by_offer_id',new.id
        ),
        updated_at=now()
    where id=new.product_id and is_active is not true;
  end if;
  return new;
end;
$function$;

revoke all on function public.ensure_trusted_offer_product_active() from public,anon,authenticated;
grant execute on function public.ensure_trusted_offer_product_active() to service_role;

drop trigger if exists trg_ensure_trusted_offer_product_active on public.offers;
create trigger trg_ensure_trusted_offer_product_active
after insert or update of product_id,status,is_verified,confidence_score
on public.offers
for each row execute function public.ensure_trusted_offer_product_active();

update public.products p
set is_active=true,
    metadata=coalesce(p.metadata,'{}'::jsonb)||jsonb_build_object(
      '_reactivated_by_trusted_offer_at',now(),
      '_reactivated_reason','existing_trusted_published_offer'
    ),
    updated_at=now()
where p.is_active is not true
  and exists(
    select 1 from public.offers o
    where o.product_id=p.id
      and o.status='published'
      and o.is_verified is true
      and coalesce(o.confidence_score,0)>=0.90
  );
