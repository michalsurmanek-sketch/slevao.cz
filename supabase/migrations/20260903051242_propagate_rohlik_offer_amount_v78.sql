create or replace function public.propagate_rohlik_offer_amount_v78()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_store_slug text;
  v_amount text;
  v_norm text;
begin
  if new.product_id is null or new.store_id is null then return new; end if;

  select s.slug into v_store_slug from public.stores s where s.id=new.store_id;
  if v_store_slug<>'rohlik' then return new; end if;
  if coalesce(new.metadata->>'adapter','') not in ('rohlik-price-hits-html-v1','rohlik-price-hits-html-v2') then return new; end if;

  v_amount:=nullif(btrim(new.metadata->>'amount'),'');
  if v_amount is null then return new; end if;
  v_norm:=public.normalize_text(v_amount);
  if v_norm !~ '^(cca )?[0-9]+([,.][0-9]+)? *(g|kg|ml|l|ks)$' then return new; end if;

  update public.products p
     set quantity_text=v_amount,
         metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
           'source_quantity_source','rohlik-offer-amount-v78',
           'source_quantity_checked_at',now()
         ),
         updated_at=now()
   where p.id=new.product_id
     and coalesce(nullif(btrim(p.quantity_text),''),'')=''
     and p.metadata->>'source_store_slug'='rohlik'
     and p.metadata->>'structured_identity_key' like 'rohlik:%';

  return new;
end;
$function$;

drop trigger if exists trg_propagate_rohlik_offer_amount_v78 on public.offers;
create trigger trg_propagate_rohlik_offer_amount_v78
after insert or update of product_id,store_id,metadata on public.offers
for each row execute function public.propagate_rohlik_offer_amount_v78();

with current_rohlik as (
  select distinct on (o.product_id) o.product_id,o.metadata->>'amount' as amount
  from public.offers o
  join public.stores st on st.id=o.store_id and st.slug='rohlik'
  where o.status='published' and o.is_verified=true
    and o.valid_from <= (now() at time zone 'Europe/Prague')::date
    and o.valid_to >= (now() at time zone 'Europe/Prague')::date
    and nullif(btrim(o.metadata->>'amount'),'') is not null
    and public.normalize_text(o.metadata->>'amount') ~ '^(cca )?[0-9]+([,.][0-9]+)? *(g|kg|ml|l|ks)$'
  order by o.product_id,o.updated_at desc nulls last,o.created_at desc
)
update public.products p
set quantity_text=c.amount,
    metadata=coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'source_quantity_source','rohlik-offer-amount-v78',
      'source_quantity_checked_at',now()
    ),
    updated_at=now()
from current_rohlik c
where p.id=c.product_id
  and coalesce(nullif(btrim(p.quantity_text),''),'')=''
  and p.metadata->>'source_store_slug'='rohlik'
  and p.metadata->>'structured_identity_key' like 'rohlik:%';
