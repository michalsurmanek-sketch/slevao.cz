create or replace function public.autofill_offer_source_url_from_metadata()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_url text;
begin
  if coalesce(new.source_url,'')='' then
    v_url := nullif(btrim(coalesce(new.metadata->>'official_product_url','')), '');
    if v_url is null then
      v_url := nullif(btrim(coalesce(new.metadata->>'leaflet_document_url','')), '');
    end if;
    if v_url is null then
      v_url := nullif(btrim(coalesce(new.metadata->>'source_document_url','')), '');
    end if;
    if v_url ~ '^https://[^[:space:]]+$' then
      new.source_url := v_url;
    end if;
  end if;
  return new;
end;
$function$;

update public.offers
set source_url=metadata->>'leaflet_document_url',
    updated_at=updated_at
where (source_url is null or btrim(source_url)='')
  and is_verified=true
  and coalesce(metadata->>'leaflet_document_url','') ~ '^https://[^[:space:]]+$';