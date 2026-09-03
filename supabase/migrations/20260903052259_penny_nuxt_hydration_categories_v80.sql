create or replace function public.parse_penny_hydration_categories_v80(p_html text)
returns table(
  external_id text,
  category_root text,
  category_leaf text,
  category_path text,
  category_items jsonb
)
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
#variable_conflict use_column
declare
  v_marker constant text := 'id="__NUXT_DATA__">';
  v_rest text;
  v_json_text text;
  v_doc jsonb;
begin
  if coalesce(p_html,'')='' or strpos(p_html,v_marker)=0 then return; end if;
  v_rest:=substring(p_html from strpos(p_html,v_marker)+length(v_marker));
  if strpos(v_rest,'</script>')=0 then return; end if;
  v_json_text:=substring(v_rest from 1 for strpos(v_rest,'</script>')-1);
  begin
    v_doc:=v_json_text::jsonb;
  exception when others then
    return;
  end;
  if jsonb_typeof(v_doc)<>'array' then return; end if;

  return query
  with product_objs as (
    select e.val as obj,
           v_doc->>((e.val->>'slug')::int) as product_slug,
           v_doc->>((e.val->>'category')::int) as leaf_name,
           (e.val->>'parentCategories')::int as parents_idx
    from jsonb_array_elements(v_doc) e(val)
    where jsonb_typeof(e.val)='object'
      and e.val ? 'slug' and e.val ? 'category' and e.val ? 'parentCategories' and e.val ? 'name'
      and jsonb_typeof(e.val->'slug')='number'
      and jsonb_typeof(e.val->'category')='number'
      and jsonb_typeof(e.val->'parentCategories')='number'
  ), actual_path as (
    select p.product_slug,p.leaf_name,
           case
             when jsonb_typeof(v_doc->p.parents_idx)='array' and jsonb_array_length(v_doc->p.parents_idx)>0
             then ((v_doc->p.parents_idx)->>0)::int
           end as path_idx
    from product_objs p
    where p.product_slug ~ '^[a-z0-9][a-z0-9-]*-[0-9]{8}$'
  ), category_rows as (
    select a.product_slug,a.leaf_name,x.ord,
           v_doc->>((v_doc->(x.ref_idx::int))->>'name')::int as category_name
    from actual_path a
    cross join lateral jsonb_array_elements_text(v_doc->a.path_idx) with ordinality x(ref_idx,ord)
    where a.path_idx is not null
      and jsonb_typeof(v_doc->a.path_idx)='array'
      and jsonb_typeof(v_doc->(x.ref_idx::int))='object'
      and (v_doc->(x.ref_idx::int)) ? 'name'
  ), grouped as (
    select product_slug,
           min(leaf_name) as leaf_name,
           (array_agg(category_name order by ord))[1] as root_name,
           string_agg(category_name,' > ' order by ord) as path_name,
           jsonb_agg(category_name order by ord) as items
    from category_rows
    where nullif(btrim(category_name),'') is not null
    group by product_slug
  )
  select g.product_slug,g.root_name,g.leaf_name,g.path_name,g.items
  from grouped g;
end;
$function$;

create or replace function public.parse_penny_structured_html(p_html text)
returns table(external_id text, title text, normalized_title text, quantity_text text, price numeric, old_price numeric, loyalty_price numeric, valid_from date, valid_to date, metadata jsonb)
language sql
stable
set search_path to 'public','pg_temp'
as $function$
with blocks as (
  select ord, block
  from regexp_split_to_table(coalesce(p_html,''), 'data-test="product-tile"') with ordinality x(block,ord)
  where ord>1
), extracted as (
  select ord,block,
    substring(block from 'data-product-slug="([^"]+)"') slug,
    replace(replace(replace(replace(substring(block from 'data-teaser-name="([^"]+)"'),'&amp;','&'),'&quot;','"'),'&#39;',''''),'&apos;','''') product_title,
    replace(replace(substring(block from '<li>([^<]+)</li>'),'&nbsp;',' '),chr(160),' ') qty,
    substring(block from 'od&nbsp;[[:alpha:]]+&nbsp;([0-9]{2}\.[0-9]{2}\.[0-9]{4})') from_text,
    substring(block from 'do&nbsp;[[:alpha:]]+&nbsp;([0-9]{2}\.[0-9]{2}\.[0-9]{4})') to_text,
    block ilike '%s PENNY kartou%' has_loyalty_price,
    (select array_agg(replace(regexp_replace(m[1],'[^0-9,]','','g'),',','.')::numeric order by n)
       from regexp_matches(block,'ws-product-price-value__main[^>]*>([^<]+)</span>','gi') with ordinality pm(m,n)) prices,
    (select replace(regexp_replace(m[1],'[^0-9,]','','g'),',','.')::numeric
       from regexp_matches(block,'<s[^>]*>([^<]+)</s>','gi') pm(m) limit 1) strike_price
  from blocks
), normalized as (
  select ord,slug,trim(product_title) product_title,nullif(trim(qty),'') qty,has_loyalty_price,prices,strike_price,
    case when from_text is not null then to_date(from_text,'DD.MM.YYYY') end from_date,
    case when to_text is not null then to_date(to_text,'DD.MM.YYYY') end to_date_value
  from extracted
  where slug is not null and product_title is not null and array_length(prices,1) between 1 and 2
), valid as (
  select ord,slug,product_title,public.normalize_product_name(product_title) norm,qty,
    case when has_loyalty_price then prices[1] else prices[array_length(prices,1)] end public_price,
    case when has_loyalty_price then prices[2] else null end card_price,
    case when has_loyalty_price then null else strike_price end previous_price,
    from_date,to_date_value,has_loyalty_price
  from normalized where from_date is not null and to_date_value is not null
), ranked as (
  select *,row_number() over(partition by norm,coalesce(qty,''),public_price,from_date,to_date_value order by ord,slug) rn
  from valid
  where length(norm)>=3 and public_price between 2 and 10000 and from_date<=to_date_value
), hydration as (
  select * from public.parse_penny_hydration_categories_v80(p_html)
)
select r.slug,r.product_title,r.norm,r.qty,r.public_price,
  case when r.previous_price is not null and r.previous_price>=r.public_price then r.previous_price else null end,
  r.card_price,r.from_date,r.to_date_value,
  jsonb_strip_nulls(jsonb_build_object(
    'adapter','penny-structured-html-v1','penny_product_slug',r.slug,
    'product_url','https://www.penny.cz/products/'||r.slug,
    'requires_loyalty_card_for_lower_price',r.has_loyalty_price,
    'loyalty_price',r.card_price,'price_without_loyalty_card',r.public_price,
    'price_policy','public_price_uses_non_member_price',
    'source_category_root',h.category_root,
    'source_category_leaf',h.category_leaf,
    'source_category_path',h.category_path,
    'source_category_items',h.category_items,
    'source_category_source',case when h.external_id is not null then 'penny-nuxt-hydration-v80' end
  ))
from ranked r
left join hydration h on h.external_id=r.slug
where r.rn=1;
$function$;

create or replace function public.propagate_penny_product_context_v58()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_is_penny boolean := false;
  v_patch jsonb;
begin
  if new.product_id is null or new.store_id is null then return new; end if;
  select exists(select 1 from public.stores s where s.id=new.store_id and s.slug='penny') into v_is_penny;
  if not v_is_penny then return new; end if;

  v_patch:=jsonb_strip_nulls(jsonb_build_object(
    'source_penny_context',true,
    'source_penny_context_source','offer-hydration-context-v80',
    'source_category_root',new.metadata->>'source_category_root',
    'source_category_leaf',new.metadata->>'source_category_leaf',
    'source_category_path',new.metadata->>'source_category_path',
    'source_category_items',new.metadata->'source_category_items',
    'source_category_source',new.metadata->>'source_category_source'
  ));

  update public.products p
     set metadata=coalesce(p.metadata,'{}'::jsonb) || v_patch,
         updated_at=now()
   where p.id=new.product_id
     and (
       coalesce(p.metadata->>'source_penny_context','false')<>'true'
       or (new.metadata ? 'source_category_root' and p.metadata->>'source_category_root' is distinct from new.metadata->>'source_category_root')
       or (new.metadata ? 'source_category_path' and p.metadata->>'source_category_path' is distinct from new.metadata->>'source_category_path')
       or (new.metadata ? 'source_category_items' and p.metadata->'source_category_items' is distinct from new.metadata->'source_category_items')
     );
  return new;
end;
$function$;

create or replace function public.infer_product_filter_group_penny_context_v80(p_name text,p_quantity_text text,p_metadata jsonb)
returns text
language plpgsql
stable parallel safe
set search_path to 'public','pg_temp'
as $function$
declare
  v_root text:=public.normalize_text(coalesce(p_metadata->>'source_category_root',''));
begin
  if coalesce(p_metadata->>'source_penny_context','false')='true'
     and coalesce(p_metadata->>'source_category_source','')='penny-nuxt-hydration-v80' then
    if v_root in ('potraviny','chlazene vyrobky','ovoce a zelenina','mrazene vyrobky','maso a uzeniny','cukrovinky') then return 'food'; end if;
    if v_root in ('napoje','alkohol','kava caj kakao') then return 'drinks'; end if;
    if v_root='drogerie' then return 'drugstore'; end if;
    if v_root='pro zvirata' then return 'pets'; end if;
  end if;
  return public.infer_product_filter_group_penny_context_v58(p_name,p_quantity_text);
end;
$function$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable parallel safe
set search_path to 'public','pg_temp'
as $function$ select 80 $function$;

do $patch_classifier$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.auto_assign_product_filter_group()'::regprocedure);
  v_new:=replace(v_def,
    'public.infer_product_filter_group_penny_context_v58(new.name,new.quantity_text)',
    'public.infer_product_filter_group_penny_context_v80(new.name,new.quantity_text,new.metadata)');
  if v_new=v_def then raise exception 'v80 classifier patch failed at PENNY inference'; end if;
  v_def:=v_new;
  v_new:=replace(v_def,'''penny-context-v58''','''penny-context-v80''');
  if v_new=v_def then raise exception 'v80 classifier patch failed at PENNY source'; end if;
  execute v_new;
end;
$patch_classifier$;

do $patch_publisher$
declare v_def text; v_new text;
begin
  v_def:=pg_get_functiondef('public.publish_penny_structured_html(text,bigint)'::regprocedure);
  v_new:=replace(v_def,'  v_count integer;','  v_count integer;'||E'\n'||'  v_category_count integer;');
  if v_new=v_def then raise exception 'v80 publisher patch failed at declaration'; end if;
  v_def:=v_new;

  v_new:=replace(v_def,
    '  select count(*),min(valid_from),max(valid_to),',
    '  select count(*),count(*) filter (where metadata->>''source_category_source''=''penny-nuxt-hydration-v80''),min(valid_from),max(valid_to),');
  if v_new=v_def then raise exception 'v80 publisher patch failed at category count select'; end if;
  v_def:=v_new;

  v_new:=replace(v_def,'    into v_count,v_from,v_to,v_signature','    into v_count,v_category_count,v_from,v_to,v_signature');
  if v_new=v_def then raise exception 'v80 publisher patch failed at category count target'; end if;
  v_def:=v_new;

  v_new:=replace(v_def,
    '  if v_count>250 then raise exception ''PENNY strukturovaný parser našel podezřele mnoho produktů: %.'',v_count; end if;',
    '  if v_count>250 then raise exception ''PENNY strukturovaný parser našel podezřele mnoho produktů: %.'',v_count; end if;'||E'\n'||
    '  if coalesce(v_category_count,0)<greatest(20,ceil(v_count*0.80)::integer) then raise exception ''PENNY hydration kategorie pokrývají jen % z % produktů; stará data zůstávají zachována.'',coalesce(v_category_count,0),v_count; end if;');
  if v_new=v_def then raise exception 'v80 publisher patch failed at hydration guard'; end if;

  execute v_new;
end;
$patch_publisher$;