-- Keep verified-offer metadata internally consistent. Several older structured
-- publishers set is_verified=true but left confidence_score at its legacy zero default,
-- producing false monitoring alarms.

create or replace function public.normalize_verified_offer_confidence()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if new.is_verified is true and coalesce(new.confidence_score,0)=0 then
    new.confidence_score:=0.95;
  end if;
  return new;
end;
$function$;

revoke all on function public.normalize_verified_offer_confidence() from public,anon,authenticated;
grant execute on function public.normalize_verified_offer_confidence() to service_role;

drop trigger if exists trg_normalize_verified_offer_confidence on public.offers;
create trigger trg_normalize_verified_offer_confidence
before insert or update of is_verified,confidence_score
on public.offers
for each row execute function public.normalize_verified_offer_confidence();

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
     and coalesce(new.confidence_score,0)>=0.90
     and new.valid_to >= (now() at time zone 'Europe/Prague')::date then
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

update public.offers
set confidence_score=0.95,
    updated_at=now()
where is_verified is true
  and coalesce(confidence_score,0)=0;
