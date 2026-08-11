-- Structured-store imports must not merge different retailer SKUs only because
-- they share a generic normalized title. Identity is scoped by official store
-- external ID; dated offer IDs are normalized to their stable SKU component.

create or replace function public.structured_store_identity_key(p_store_slug text, p_external_id text)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_store text := lower(trim(coalesce(p_store_slug,'')));
  v_external text := trim(coalesce(p_external_id,''));
begin
  if v_store = '' or v_external = '' then return null; end if;
  if v_external ~ '^[^:]+:[^:]+:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return v_store || ':' || split_part(v_external, ':', 2);
  end if;
  return v_external;
end;
$function$;

-- Backfill identity metadata where an existing structured product already maps
-- to exactly one store-scoped external identity.
with structured_stores as (
  select s.id,s.slug
  from public.store_product_sync_state ss
  join public.stores s on s.id=ss.store_id
  where ss.source_type='official-structured'
), grouped as (
  select o.product_id,
         min(s.slug) as store_slug,
         min(public.structured_store_identity_key(s.slug,o.external_id)) as identity_key,
         count(distinct s.slug || '|' || public.structured_store_identity_key(s.slug,o.external_id)) as identity_count
  from public.offers o
  join structured_stores s on s.id=o.store_id
  where o.product_id is not null and coalesce(o.external_id,'')<>''
  group by o.product_id
)
update public.products p
set metadata = coalesce(p.metadata,'{}'::jsonb) || jsonb_build_object(
      'structured_identity_version',2,
      'structured_identity_key',g.identity_key,
      'structured_external_id',g.identity_key,
      'source_store_slug',g.store_slug
    ),
    updated_at=now()
from grouped g
where p.id=g.product_id
  and g.identity_count=1
  and coalesce(p.metadata->>'created_from_structured_store_import','false')='true'
  and coalesce(p.metadata->>'source_store_slug',g.store_slug)=g.store_slug;

-- Preserve official structured identities in the generic matching triggers.
create or replace function public.apply_library_image_to_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  resolved record;
  library_image text;
  store_slug text;
  offer_kl_nr text;
  product_kl_nr text;
  adapter text;
  parsed_quantity text;
  intended_quantity text;
  structured_key text;
  product_structured_key text;
  product_source_store text;
begin
  if new.store_id is not null then
    select s.slug into store_slug from public.stores s where s.id = new.store_id;
  end if;

  adapter := lower(coalesce(new.metadata ->> 'adapter', ''));

  if new.product_id is not null and coalesce(new.external_id,'')<>'' then
    structured_key := public.structured_store_identity_key(store_slug,new.external_id);
    select p.metadata->>'structured_identity_key',p.metadata->>'source_store_slug'
      into product_structured_key,product_source_store
    from public.products p where p.id=new.product_id;
    if structured_key is not null
       and product_structured_key=structured_key
       and product_source_store=store_slug then
      library_image := public.active_verified_product_image(new.product_id);
      if library_image is not null then new.image_url := library_image;
      elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
      end if;
      return new;
    end if;
  end if;

  if store_slug = 'albert'
     and adapter = 'albert-products-publitas-text-v4'
     and new.product_id is not null then
    parsed_quantity := public.product_quantity_key(new.metadata ->> 'parsed_quantity');
    select public.product_quantity_key(coalesce(p.quantity_text, p.name))
      into intended_quantity
    from public.products p
    where p.id = new.product_id;
    if parsed_quantity is not null and intended_quantity = parsed_quantity then
      library_image := public.active_verified_product_image(new.product_id);
      if library_image is not null then new.image_url := library_image;
      elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
      end if;
      return new;
    end if;
  end if;

  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> 'kaufland_kl_nr', '')), '');
  if store_slug = 'kaufland' and offer_kl_nr is not null and new.product_id is not null then
    select nullif(trim(coalesce(p.metadata ->> 'kaufland_kl_nr', '')), '')
      into product_kl_nr
    from public.products p
    where p.id = new.product_id;
    if product_kl_nr = offer_kl_nr then
      library_image := public.active_verified_product_image(new.product_id);
      if library_image is not null then new.image_url := library_image;
      elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
      end if;
      return new;
    end if;
  end if;

  select * into resolved
  from public.resolve_product_for_import(new.title, null, null, null, new.store_id)
  limit 1;

  if resolved.matched_product_id is not null then
    new.product_id := resolved.matched_product_id;
  end if;

  if new.product_id is not null then
    library_image := public.active_verified_product_image(new.product_id);
    if library_image is not null then new.image_url := library_image;
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.match_offer_to_product_master()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  normalized_title text;
  matched_product_id uuid;
  matched_image_url text;
  candidate_count integer := 0;
  previous_product_id uuid;
  store_slug text;
  offer_kl_nr text;
  product_kl_nr text;
  adapter text;
  parsed_quantity text;
  intended_quantity text;
  structured_key text;
  product_structured_key text;
  product_source_store text;
begin
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else new.product_id end;
  if new.store_id is not null then
    select s.slug into store_slug from public.stores s where s.id = new.store_id;
  end if;

  adapter := lower(coalesce(new.metadata ->> 'adapter', ''));

  if new.product_id is not null and coalesce(new.external_id,'')<>'' then
    structured_key := public.structured_store_identity_key(store_slug,new.external_id);
    select p.metadata->>'structured_identity_key',p.metadata->>'source_store_slug'
      into product_structured_key,product_source_store
    from public.products p where p.id=new.product_id;
    if structured_key is not null
       and product_structured_key=structured_key
       and product_source_store=store_slug then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
  end if;

  if store_slug = 'albert'
     and adapter = 'albert-products-publitas-text-v4'
     and new.product_id is not null then
    parsed_quantity := public.product_quantity_key(new.metadata ->> 'parsed_quantity');
    select public.product_quantity_key(coalesce(p.quantity_text, p.name))
      into intended_quantity
    from public.products p
    where p.id = new.product_id;
    if parsed_quantity is not null and intended_quantity = parsed_quantity then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
  end if;

  offer_kl_nr := nullif(trim(coalesce(new.metadata ->> 'kaufland_kl_nr', '')), '');
  if store_slug = 'kaufland' and offer_kl_nr is not null and new.product_id is not null then
    select nullif(trim(coalesce(p.metadata ->> 'kaufland_kl_nr', '')), '')
      into product_kl_nr
    from public.products p
    where p.id = new.product_id;
    if product_kl_nr = offer_kl_nr then
      new.catalog_match_status := case when previous_product_id = new.product_id then 'retained' else 'matched' end;
      new.catalog_match_score := 1;
      new.catalog_checked_at := now();
      return new;
    end if;
    new.catalog_match_status := 'needs_review';
    new.catalog_match_score := null;
    new.catalog_checked_at := now();
    return new;
  end if;

  normalized_title := public.normalize_product_name(new.title);
  if normalized_title = '' or not public.product_label_is_specific(new.title) then
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      new.product_id := old.product_id;
      new.image_url := old.image_url;
      new.catalog_match_status := 'needs_review';
      new.catalog_match_score := null;
      new.catalog_checked_at := now();
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
    end if;
    return new;
  end if;

  with candidates as (
    select distinct p.id,
      case when p.image_url is not null and p.image_verified = true and coalesce(p.image_quality, 0) >= 70 and p.image_url not like '%/leaflet-crops/%' then p.image_url else null end as approved_image
    from public.products p
    where p.normalized_name = normalized_title
      and public.product_identity_match_safe(new.title, p.name, p.brand, p.quantity_text)
  ), ranked as (
    select *, count(*) over () as total
    from candidates
    order by (approved_image is not null) desc, id
  )
  select id, approved_image, total into matched_product_id, matched_image_url, candidate_count from ranked limit 1;

  if not found then candidate_count := 0; matched_product_id := null; matched_image_url := null; end if;

  if candidate_count = 0 then
    with candidates as (
      select distinct p.id,
        case when p.image_url is not null and p.image_verified = true and coalesce(p.image_quality, 0) >= 70 and p.image_url not like '%/leaflet-crops/%' then p.image_url else null end as approved_image
      from public.product_aliases a
      join public.products p on p.id = a.product_id
      where a.normalized_alias = normalized_title
        and a.confidence >= 0.92
        and (a.brand is not null or a.quantity_text is not null)
        and public.product_identity_match_safe(new.title,a.alias,coalesce(a.brand,p.brand),coalesce(a.quantity_text,p.quantity_text))
    ), ranked as (
      select *, count(*) over () as total
      from candidates
      order by (approved_image is not null) desc, id
    )
    select id, approved_image, total into matched_product_id, matched_image_url, candidate_count from ranked limit 1;
    if not found then candidate_count := 0; matched_product_id := null; matched_image_url := null; end if;
  end if;

  if candidate_count = 1 then
    new.product_id := matched_product_id;
    if matched_image_url is not null then new.image_url := matched_image_url;
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
    end if;
    new.catalog_match_status := case when previous_product_id = matched_product_id then 'retained' else 'matched' end;
    new.catalog_match_score := 1;
    new.catalog_checked_at := now();
  else
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      new.product_id := old.product_id;
      new.image_url := old.image_url;
      new.catalog_match_status := 'needs_review';
      new.catalog_match_score := null;
      new.catalog_checked_at := now();
    elsif new.image_url like '%/leaflet-crops/%' then new.image_url := null;
    end if;
  end if;
  return new;
end;
$function$;

-- Split all current/historical structured offers whose product does not match
-- their store-scoped official identity. This also fixes same-store collisions
-- such as two different JYSK IDs sharing the same title.
do $block$
declare
  r record;
  v_product_id uuid;
  v_qty text;
  v_brand text;
  v_category_id uuid;
  v_brand_id uuid;
  v_description text;
  v_identity text;
  v_import_id uuid;
begin
  for r in
    with structured_stores as (
      select s.id,s.slug
      from public.store_product_sync_state ss
      join public.stores s on s.id=ss.store_id
      where ss.source_type='official-structured'
    )
    select o.id offer_id,o.product_id old_product_id,o.store_id,s.slug store_slug,o.external_id,o.title,o.normalized_title,
           o.image_url,o.category_id,o.metadata offer_metadata,
           p.category_id old_category_id,p.brand_id old_brand_id,p.description old_description,p.brand old_brand,p.quantity_text old_qty,
           p.metadata old_product_metadata,
           public.structured_store_identity_key(s.slug,o.external_id) identity_key
    from public.offers o
    join structured_stores s on s.id=o.store_id
    left join public.products p on p.id=o.product_id
    where coalesce(o.external_id,'')<>''
      and (
        o.product_id is null
        or coalesce(p.metadata->>'structured_identity_key','') <> public.structured_store_identity_key(s.slug,o.external_id)
        or coalesce(p.metadata->>'source_store_slug','') <> s.slug
      )
    order by s.slug,o.created_at,o.id
  loop
    v_identity := r.identity_key;
    if v_identity is null then continue; end if;

    select p.id into v_product_id
    from public.products p
    where p.is_active=true and p.metadata->>'structured_identity_key'=v_identity
    order by p.created_at,p.id limit 1;

    if v_product_id is null then
      v_import_id := null;
      if coalesce(r.offer_metadata->>'import_id','') ~ '^[0-9a-fA-F-]{36}$' then
        v_import_id := (r.offer_metadata->>'import_id')::uuid;
      end if;
      v_qty := null;
      if v_import_id is not null then
        select li.quantity_text into v_qty
        from public.leaflet_import_items li
        where li.import_id=v_import_id
          and (li.raw_data->>'external_id'=r.external_id or li.raw_data->>'offer_id'=r.offer_id::text)
        order by li.created_at desc limit 1;
      end if;
      v_qty := coalesce(v_qty,r.old_qty);
      v_brand := coalesce(nullif(r.offer_metadata->>'brand',''),r.old_brand);
      v_category_id := coalesce(r.category_id,r.old_category_id);
      v_brand_id := r.old_brand_id;
      v_description := r.old_description;

      insert into public.products(
        category_id,brand_id,name,normalized_name,description,brand,quantity_text,
        image_url,image_source,image_quality,image_verified,image_checked_at,
        is_active,is_verified,metadata
      ) values (
        v_category_id,v_brand_id,r.title,coalesce(nullif(r.normalized_title,''),public.normalize_product_name(r.title)),v_description,v_brand,v_qty,
        r.image_url,case when r.image_url is not null then 'official_structured_store' else null end,
        case when r.image_url is not null then 90 else 0 end,r.image_url is not null,case when r.image_url is not null then now() else null end,
        true,true,jsonb_strip_nulls(jsonb_build_object(
          'created_from_structured_store_import',true,
          'source_store_slug',r.store_slug,
          'adapter',r.offer_metadata->>'adapter',
          'structured_identity_version',2,
          'structured_identity_key',v_identity,
          'structured_external_id',v_identity,
          'split_from_product_id',r.old_product_id,
          'identity_repaired_at',now()
        ))
      ) returning id into v_product_id;

      insert into public.product_aliases(product_id,alias,normalized_alias,brand,quantity_text,source_store_id,confidence)
      values(v_product_id,r.title,public.normalize_product_name(r.title),v_brand,v_qty,r.store_id,1)
      on conflict(product_id,normalized_alias) do update set
        alias=excluded.alias,brand=coalesce(excluded.brand,public.product_aliases.brand),quantity_text=coalesce(excluded.quantity_text,public.product_aliases.quantity_text),
        source_store_id=excluded.source_store_id,confidence=greatest(public.product_aliases.confidence,excluded.confidence),updated_at=now();
    end if;

    update public.offers
    set product_id=v_product_id,catalog_match_status='matched',catalog_match_score=1,catalog_checked_at=now(),updated_at=now()
    where id=r.offer_id and product_id is distinct from v_product_id;

    update public.price_history
    set product_id=v_product_id
    where offer_id=r.offer_id and product_id is distinct from v_product_id;

    if coalesce(r.offer_metadata->>'import_id','') ~ '^[0-9a-fA-F-]{36}$' then
      update public.leaflet_import_items li
      set product_id=v_product_id,updated_at=now()
      where li.import_id=(r.offer_metadata->>'import_id')::uuid
        and (li.raw_data->>'external_id'=r.external_id or li.raw_data->>'offer_id'=r.offer_id::text)
        and li.product_id is distinct from v_product_id;
    end if;
  end loop;
end
$block$;

create unique index if not exists ux_products_active_structured_identity
on public.products ((metadata->>'structured_identity_key'))
where is_active=true and coalesce(metadata->>'structured_identity_key','')<>'';

-- Future structured syncs resolve by store-scoped official identity instead of
-- normalized title. This prevents cross-store and same-title SKU collisions.
create or replace function public.publish_structured_store_offers(
  p_store_slug text,
  p_adapter text,
  p_signature text,
  p_rows jsonb,
  p_min_products integer default 1,
  p_max_products integer default 5000,
  p_source_document_url text default null,
  p_parser_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare
  v_store_id uuid;
  v_store_name text;
  v_source_id uuid;
  v_import_id uuid;
  v_existing_import uuid;
  v_row jsonb;
  v_product_id uuid;
  v_offer_id uuid;
  v_offer_ids uuid[] := array[]::uuid[];
  v_input_count integer := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  v_published integer := 0;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_matched integer := 0;
  v_from date;
  v_to date;
  v_title text;
  v_norm text;
  v_qty text;
  v_brand text;
  v_price numeric;
  v_old_price numeric;
  v_external text;
  v_identity text;
  v_source_url text;
  v_image text;
  v_conf numeric;
  v_source_page integer;
  v_now timestamptz := now();
  v_parser text := coalesce(nullif(trim(p_parser_version), ''), p_adapter);
begin
  p_store_slug := lower(trim(coalesce(p_store_slug, '')));
  p_adapter := trim(coalesce(p_adapter, ''));

  if p_store_slug = '' then raise exception 'Chybí slug obchodu.'; end if;
  if p_adapter = '' or length(p_adapter) > 120 then raise exception 'Adapter je neplatný.'; end if;
  if coalesce(length(p_signature), 0) < 16 or length(p_signature) > 256 then raise exception 'Podpis zdroje je neplatný.'; end if;
  if p_min_products < 1 or p_max_products < p_min_products or p_max_products > 10000 then raise exception 'Bezpečnostní rozsah produktů je neplatný.'; end if;
  if v_input_count < p_min_products then raise exception '% parser našel jen % nabídek; minimum je %.', p_store_slug, v_input_count, p_min_products; end if;
  if v_input_count > p_max_products then raise exception '% parser našel podezřele mnoho nabídek: %.', p_store_slug, v_input_count; end if;

  select id, name into v_store_id, v_store_name from public.stores where slug = p_store_slug;
  if v_store_id is null then raise exception 'Obchod % nebyl nalezen.', p_store_slug; end if;

  select id into v_source_id
  from public.leaflet_sources
  where store_id = v_store_id and is_active = true
  order by last_success_at desc nulls last, created_at
  limit 1;
  if v_source_id is null then raise exception 'Obchod % nemá aktivní zdroj.', p_store_slug; end if;

  select id into v_existing_import from public.leaflet_imports where source_hash = p_adapter || ':' || p_signature limit 1;
  if v_existing_import is null then
    insert into public.leaflet_imports(source_id,store_id,source_document_url,source_hash,status,product_count,confidence,coverage_scope,detected_valid_from,detected_valid_to,started_at,metadata)
    values(v_source_id,v_store_id,coalesce(p_source_document_url,''),p_adapter||':'||p_signature,'processing',0,0.95,'national',current_date,current_date,v_now,
      jsonb_build_object('adapter',p_adapter,'source_signature',p_signature,'automatic',true,'parser_version',v_parser,'product_identity','structured-store-external-v2'))
    returning id into v_import_id;
  else
    v_import_id := v_existing_import;
    delete from public.leaflet_import_items where import_id=v_import_id;
    update public.leaflet_imports set status='processing',error_message=null,started_at=v_now,finished_at=null,
      source_document_url=coalesce(p_source_document_url,source_document_url),updated_at=v_now where id=v_import_id;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_title := trim(coalesce(v_row->>'title',''));
    v_norm := trim(coalesce(v_row->>'normalized_title',''));
    v_qty := nullif(trim(coalesce(v_row->>'quantity_text','')),'');
    v_brand := coalesce(nullif(trim(coalesce(v_row->>'brand','')),''),nullif(trim(coalesce(v_row->'metadata'->>'brand','')),''));
    v_price := nullif(v_row->>'price','')::numeric;
    v_old_price := nullif(v_row->>'old_price','')::numeric;
    v_external := trim(coalesce(v_row->>'external_id',''));
    v_identity := public.structured_store_identity_key(p_store_slug,v_external);
    v_source_url := nullif(trim(coalesce(v_row->>'source_url','')),'');
    v_image := nullif(trim(coalesce(v_row->>'image_url','')),'');
    v_conf := coalesce(nullif(v_row->>'confidence','')::numeric,0.95);
    v_from := nullif(v_row->>'valid_from','')::date;
    v_to := nullif(v_row->>'valid_to','')::date;
    v_product_id := nullif(v_row->>'product_id','')::uuid;
    v_source_page := nullif(v_row->>'source_page','')::integer;

    if v_title='' or v_norm='' or v_external='' or v_identity is null or coalesce(v_price,0)<=0 or v_price>100000 or v_from is null or v_to is null or v_from>v_to then
      v_skipped := v_skipped+1; continue;
    end if;
    if v_old_price is not null and v_old_price<=v_price then v_old_price:=null; end if;
    if v_conf<0.50 or v_conf>1 then v_conf:=greatest(0.50,least(1,v_conf)); end if;

    if v_product_id is not null and not exists(select 1 from public.products where id=v_product_id) then v_product_id:=null; end if;
    if v_product_id is null then
      select p.id into v_product_id
      from public.products p
      where p.is_active=true and p.metadata->>'structured_identity_key'=v_identity
      order by p.created_at,p.id limit 1;
      if v_product_id is not null then v_matched:=v_matched+1; end if;
    else
      v_matched:=v_matched+1;
    end if;

    if v_product_id is null then
      insert into public.products(name,normalized_name,brand,quantity_text,image_url,image_source,image_quality,image_verified,image_checked_at,is_verified,metadata)
      values(v_title,v_norm,v_brand,v_qty,v_image,case when v_image is not null then 'official_structured_store' else null end,
        case when v_image is not null then 90 else 0 end,v_image is not null,case when v_image is not null then v_now else null end,true,
        jsonb_strip_nulls(jsonb_build_object('created_from_structured_store_import',true,'source_store_slug',p_store_slug,'adapter',p_adapter,
          'structured_identity_version',2,'structured_identity_key',v_identity,'structured_external_id',v_identity,'created_at',v_now)))
      returning id into v_product_id;
    else
      update public.products set
        name=v_title,normalized_name=v_norm,brand=coalesce(v_brand,brand),quantity_text=coalesce(v_qty,quantity_text),
        image_url=case when v_image is not null and (image_url is null or coalesce(image_quality,0)<80) then v_image else image_url end,
        image_source=case when v_image is not null and (image_url is null or coalesce(image_quality,0)<80) then 'official_structured_store' else image_source end,
        image_quality=case when v_image is not null and (image_url is null or coalesce(image_quality,0)<80) then 90 else image_quality end,
        image_verified=case when v_image is not null then true else image_verified end,
        image_checked_at=case when v_image is not null then v_now else image_checked_at end,
        is_active=true,is_verified=true,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('created_from_structured_store_import',true,'source_store_slug',p_store_slug,
          'adapter',p_adapter,'structured_identity_version',2,'structured_identity_key',v_identity,'structured_external_id',v_identity)),updated_at=v_now
      where id=v_product_id;
    end if;

    insert into public.product_aliases(product_id,alias,normalized_alias,brand,quantity_text,source_store_id,confidence)
    values(v_product_id,v_title,v_norm,v_brand,v_qty,v_store_id,v_conf)
    on conflict(product_id,normalized_alias) do update set alias=excluded.alias,brand=coalesce(excluded.brand,public.product_aliases.brand),
      quantity_text=coalesce(excluded.quantity_text,public.product_aliases.quantity_text),source_store_id=excluded.source_store_id,
      confidence=greatest(public.product_aliases.confidence,excluded.confidence),updated_at=now();

    if v_image is null then select image_url into v_image from public.products where id=v_product_id; end if;

    v_offer_id:=null;
    select o.id into v_offer_id
    from public.offers o
    where o.store_id=v_store_id and (
      o.external_id=v_external or (
        lower(btrim(o.title))=lower(btrim(v_title)) and o.valid_from=v_from and o.valid_to=v_to and o.coverage_scope='national'
        and coalesce(o.region_code,'')='' and coalesce(o.city_name,'')='' and coalesce(o.store_location_name,'')=''
      )
    )
    order by case when o.external_id=v_external then 0 when o.status='published' then 1 else 2 end,o.created_at
    limit 1;

    if v_offer_id is null then
      insert into public.offers(product_id,store_id,title,normalized_title,image_url,source_url,external_id,price,old_price,valid_from,valid_to,status,is_verified,confidence_score,coverage_scope,metadata,published_at)
      values(v_product_id,v_store_id,v_title,v_norm,v_image,v_source_url,v_external,v_price,v_old_price,v_from,v_to,'published',v_conf>=0.9,v_conf,'national',
        coalesce(v_row->'metadata','{}'::jsonb)||jsonb_build_object('adapter',p_adapter,'source_signature',p_signature,'import_id',v_import_id,'structured_identity_key',v_identity),v_now)
      returning id into v_offer_id;
    else
      update public.offers set product_id=v_product_id,title=v_title,normalized_title=v_norm,image_url=coalesce(v_image,image_url),source_url=v_source_url,external_id=v_external,
        price=v_price,old_price=v_old_price,valid_from=v_from,valid_to=v_to,status='published',is_verified=v_conf>=0.9,confidence_score=v_conf,
        coverage_scope='national',region_code=null,city_name=null,store_location_name=null,
        metadata=coalesce(v_row->'metadata','{}'::jsonb)||jsonb_build_object('adapter',p_adapter,'source_signature',p_signature,'import_id',v_import_id,'structured_identity_key',v_identity),
        published_at=v_now,updated_at=v_now where id=v_offer_id;
    end if;

    v_offer_ids:=array_append(v_offer_ids,v_offer_id);
    v_published:=v_published+1;
    insert into public.leaflet_import_items(import_id,product_id,title,brand,quantity_text,price,old_price,image_url,source_page,confidence,status,raw_data)
    values(v_import_id,v_product_id,v_title,v_brand,v_qty,v_price,v_old_price,v_image,v_source_page,v_conf,'published',
      coalesce(v_row->'metadata','{}'::jsonb)||jsonb_build_object('offer_id',v_offer_id,'external_id',v_external,'structured_identity_key',v_identity));
  end loop;

  if v_published<p_min_products then raise exception 'Po bezpečnostních filtrech zůstalo jen % nabídek pro %; předchozí sada zůstává zachovaná.',v_published,p_store_slug; end if;

  with expired as (
    update public.offers set status='expired',updated_at=v_now
    where store_id=v_store_id and status='published' and not(id=any(v_offer_ids)) returning id
  ) select count(*) into v_expired from expired;

  select min((x->>'valid_from')::date),max((x->>'valid_to')::date) into v_from,v_to from jsonb_array_elements(p_rows) x;

  update public.leaflet_imports set status='published',product_count=v_published,confidence=0.95,detected_valid_from=v_from,detected_valid_to=v_to,error_message=null,
    finished_at=v_now,metadata=jsonb_build_object('adapter',p_adapter,'source_signature',p_signature,'automatic',true,'parser_version',v_parser,
      'matched_catalog_products',v_matched,'published_products',v_published,'skipped_products',v_skipped,'product_identity','structured-store-external-v2'),updated_at=v_now
  where id=v_import_id;

  update public.leaflet_imports set status='ignored',updated_at=v_now
  where store_id=v_store_id and id<>v_import_id and status='published' and metadata->>'adapter'=p_adapter;

  insert into public.store_product_sync_state(store_id,last_run_at,last_success_at,last_source_signature,source_fingerprint,product_set_hash,last_offer_count,expected_offer_count,last_published_count,last_valid_from,last_valid_to,
    parser_version,adapter_name,adapter_version,source_type,source_category,last_error,last_parser_error,health_status,health_reason,is_running,run_started_at,updated_at,last_import_id)
  values(v_store_id,v_now,v_now,p_signature,p_signature,p_signature,v_published,v_published,v_published,v_from,v_to,v_parser,p_adapter,v_parser,'official-structured','current-leaflet',null,null,
    'ok',format('Automaticky publikováno %s nabídek %s se striktní identitou.',v_published,v_store_name),false,null,v_now,v_import_id)
  on conflict(store_id) do update set last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,last_source_signature=excluded.last_source_signature,
    source_fingerprint=excluded.source_fingerprint,product_set_hash=excluded.product_set_hash,last_offer_count=excluded.last_offer_count,expected_offer_count=excluded.expected_offer_count,
    last_published_count=excluded.last_published_count,last_valid_from=excluded.last_valid_from,last_valid_to=excluded.last_valid_to,parser_version=excluded.parser_version,
    adapter_name=excluded.adapter_name,adapter_version=excluded.adapter_version,source_type=excluded.source_type,source_category=excluded.source_category,last_error=null,last_parser_error=null,
    health_status='ok',health_reason=excluded.health_reason,is_running=false,run_started_at=null,updated_at=v_now,last_import_id=v_import_id;

  update public.leaflet_sources set last_checked_at=v_now,last_success_at=v_now,last_error=null,last_strategy_used='official_structured_products',last_strategy_success_at=v_now where id=v_source_id;

  return jsonb_build_object('ok',true,'store_slug',p_store_slug,'import_id',v_import_id,'input',v_input_count,'published',v_published,'skipped',v_skipped,'expired',v_expired,
    'matched_catalog_products',v_matched,'signature',p_signature,'product_identity','structured-store-external-v2');
end;
$function$;
