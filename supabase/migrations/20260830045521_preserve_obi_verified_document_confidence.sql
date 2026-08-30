create or replace function public.normalize_verified_obi_bonial_leaflet_status()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(new.metadata->>'adapter',old.metadata->>'adapter','')='obi-bonial-v1' then
    new.confidence:=coalesce(new.confidence,old.confidence);
  end if;

  if coalesce(new.metadata->>'adapter','') = 'obi-bonial-v1'
     and coalesce(new.confidence,0) >= 0.99
     and coalesce(new.product_count,0) = 0
     and new.detected_valid_from is not null
     and new.detected_valid_to is not null
     and coalesce(new.metadata->>'official_viewer_url','') like 'https://www.obi.cz/nabidky/aktualni-letak?brochureId=%'
     and coalesce(new.metadata->>'brochure_id','') ~ '^[0-9a-fA-F-]{36}$'
     and coalesce(new.metadata->>'page_count','') ~ '^[0-9]+$'
     and (new.metadata->>'page_count')::integer > 0
     and coalesce(new.source_document_url,'') ~ '^https://aws-ops-bonial-biz-production-published-content-pdf[.]s3-eu-west-1[.]amazonaws[.]com/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.]pdf$'
     and exists (
       select 1
       from public.leaflet_sources ls
       join public.stores s on s.id=ls.store_id
       where ls.id=new.source_id
         and s.slug='obi'
         and ls.is_active=true
         and ls.source_url='https://www.obi.cz/nabidky/aktualni-letak'
     )
  then
    new.status := 'published';
    new.error_message := null;
    new.finished_at := coalesce(new.finished_at, now());
  end if;
  return new;
end;
$function$;

update public.leaflet_imports
set confidence=0.99,
    status='review',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_only',true,'document_product_mode','no_deterministic_sku_price_pairs'),
    updated_at=now()
where id='81b91a00-cd67-4ec7-854f-dac39c82d075';
