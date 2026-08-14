create or replace function public.slevao_clean_coop_offer_title()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_clean text;
begin
  if coalesce(new.metadata->>'adapter','') = 'coop-verified-pdf-text-v1'
     and coalesce(new.title,'') ~ '^[[:space:]]*[0-9]{1,4}[[:space:]]*[,\.]?[[:space:]]*(?:[0-9]{2}|[–-])[[:space:]]+' then
    v_clean := regexp_replace(
      new.title,
      '^[[:space:]]*[0-9]{1,4}[[:space:]]*[,\.]?[[:space:]]*(?:[0-9]{2}|[–-])[[:space:]]+',
      '',
      'i'
    );
    if length(btrim(v_clean)) >= 3 then
      new.title := btrim(v_clean);
      new.normalized_title := public.normalize_product_name(new.title);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_slevao_clean_coop_offer_title on public.offers;
create trigger trg_slevao_clean_coop_offer_title
before insert or update of title, metadata on public.offers
for each row execute function public.slevao_clean_coop_offer_title();

with fixed as (
  update public.offers o
  set title=regexp_replace(o.title,'^[[:space:]]*[0-9]{1,4}[[:space:]]*[,\.]?[[:space:]]*(?:[0-9]{2}|[–-])[[:space:]]+','','i'),
      normalized_title=public.normalize_product_name(regexp_replace(o.title,'^[[:space:]]*[0-9]{1,4}[[:space:]]*[,\.]?[[:space:]]*(?:[0-9]{2}|[–-])[[:space:]]+','','i')),
      updated_at=now()
  from public.stores s
  where o.store_id=s.id and s.slug='coop'
    and coalesce(o.metadata->>'adapter','')='coop-verified-pdf-text-v1'
    and o.title ~ '^[[:space:]]*[0-9]{1,4}[[:space:]]*[,\.]?[[:space:]]*(?:[0-9]{2}|[–-])[[:space:]]+'
  returning o.product_id,o.title,o.normalized_title
)
update public.products p
set name=f.title,normalized_name=f.normalized_title,updated_at=now()
from fixed f
where p.id=f.product_id and coalesce(p.metadata->>'verified_by_coop_pdf','false')='true';
