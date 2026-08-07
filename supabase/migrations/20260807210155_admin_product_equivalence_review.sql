create or replace function public.admin_list_product_equivalence_queue()
returns table (
  product_id_a uuid,
  product_id_b uuid,
  product_name_a text,
  product_name_b text,
  brand text,
  quantity_key text,
  store_a text,
  store_b text,
  offer_title_a text,
  offer_title_b text,
  latest_valid_to date,
  review_status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  role_name text := coalesce(auth.jwt()->'app_metadata'->>'role','');
begin
  if auth.uid() is null or role_name not in ('admin','editor') then
    raise exception 'Admin or editor role required';
  end if;
  return query
  select q.product_id_a,q.product_id_b,q.product_name_a,q.product_name_b,q.brand,q.quantity_key,
         q.store_a,q.store_b,q.offer_title_a,q.offer_title_b,q.latest_valid_to,q.review_status
  from public.product_equivalence_review_queue q
  order by q.latest_valid_to desc,q.brand,q.product_name_a;
end;
$$;

create or replace function public.admin_list_product_equivalence_history()
returns table (
  equivalence_id uuid,
  product_id_a uuid,
  product_id_b uuid,
  product_name_a text,
  product_name_b text,
  match_method text,
  confidence numeric,
  is_active boolean,
  evidence jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  role_name text := coalesce(auth.jwt()->'app_metadata'->>'role','');
begin
  if auth.uid() is null or role_name not in ('admin','editor') then
    raise exception 'Admin or editor role required';
  end if;
  return query
  select e.id,e.product_id_a,e.product_id_b,a.name,b.name,e.match_method,e.confidence,e.is_active,e.evidence,e.updated_at
  from public.product_equivalences e
  join public.products a on a.id=e.product_id_a
  join public.products b on b.id=e.product_id_b
  order by e.updated_at desc,e.created_at desc;
end;
$$;

create or replace function public.admin_set_product_equivalence(
  p_product_id_a uuid,
  p_product_id_b uuid,
  p_approved boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  role_name text := coalesce(auth.jwt()->'app_metadata'->>'role','');
  a_id uuid;
  b_id uuid;
  existing_id uuid;
  a_name text;
  b_name text;
  a_brand text;
  b_brand text;
  a_qty text;
  b_qty text;
  a_verified boolean;
  b_verified boolean;
begin
  if auth.uid() is null or role_name <> 'admin' then
    raise exception 'Admin role required';
  end if;
  if p_product_id_a is null or p_product_id_b is null or p_product_id_a=p_product_id_b then
    raise exception 'Two different product ids are required';
  end if;

  select name,brand,public.product_quantity_key(coalesce(quantity_text,name)),is_verified
    into a_name,a_brand,a_qty,a_verified
  from public.products where id=p_product_id_a;
  select name,brand,public.product_quantity_key(coalesce(quantity_text,name)),is_verified
    into b_name,b_brand,b_qty,b_verified
  from public.products where id=p_product_id_b;

  if a_name is null or b_name is null then
    raise exception 'Product not found';
  end if;
  if a_verified is not true or b_verified is not true then
    raise exception 'Both products must be verified';
  end if;
  if coalesce(public.normalize_product_name(a_brand),'')='' or public.normalize_product_name(a_brand)<>public.normalize_product_name(b_brand) then
    raise exception 'Product brands do not match';
  end if;
  if a_qty is null or b_qty is null or a_qty<>b_qty then
    raise exception 'Product package quantities do not match';
  end if;

  if p_product_id_a::text < p_product_id_b::text then
    a_id:=p_product_id_a; b_id:=p_product_id_b;
  else
    a_id:=p_product_id_b; b_id:=p_product_id_a;
  end if;

  select id into existing_id
  from public.product_equivalences
  where least(product_id_a,product_id_b)=a_id
    and greatest(product_id_a,product_id_b)=b_id
  limit 1;

  if existing_id is null then
    insert into public.product_equivalences(product_id_a,product_id_b,match_method,confidence,evidence,is_active)
    values (
      a_id,b_id,'manual_review',case when p_approved then 1.0000 else 0.0000 end,
      jsonb_build_object(
        'approved',p_approved,
        'reviewed_by',auth.uid(),
        'reviewed_at',now(),
        'note',nullif(trim(coalesce(p_note,'')),'')
      ),
      p_approved
    )
    returning id into existing_id;
  else
    update public.product_equivalences
    set match_method='manual_review',
        confidence=case when p_approved then 1.0000 else 0.0000 end,
        is_active=p_approved,
        evidence=coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
          'approved',p_approved,
          'reviewed_by',auth.uid(),
          'reviewed_at',now(),
          'note',nullif(trim(coalesce(p_note,'')),'')
        ),
        updated_at=now()
    where id=existing_id;
  end if;

  return jsonb_build_object(
    'id',existing_id,
    'approved',p_approved,
    'product_a',a_name,
    'product_b',b_name,
    'brand',a_brand,
    'quantity',a_qty
  );
end;
$$;

revoke all on function public.admin_list_product_equivalence_queue() from public, anon;
revoke all on function public.admin_list_product_equivalence_history() from public, anon;
revoke all on function public.admin_set_product_equivalence(uuid,uuid,boolean,text) from public, anon;
grant execute on function public.admin_list_product_equivalence_queue() to authenticated;
grant execute on function public.admin_list_product_equivalence_history() to authenticated;
grant execute on function public.admin_set_product_equivalence(uuid,uuid,boolean,text) to authenticated;

create or replace view public.product_equivalence_review_queue
with (security_invoker = true)
as
with recent as (
  select distinct on (o.product_id,o.store_id)
    o.product_id,o.store_id,s.name as store_name,o.title as offer_title,o.valid_from,o.valid_to,
    p.name as product_name,p.normalized_name,p.brand,p.quantity_text,
    public.normalize_product_name(p.brand) as brand_key,
    public.product_quantity_key(coalesce(p.quantity_text,o.title)) as quantity_key
  from public.offers o
  join public.products p on p.id=o.product_id
  join public.stores s on s.id=o.store_id
  where o.product_id is not null
    and o.is_verified=true
    and o.catalog_match_status in ('matched','retained')
    and o.valid_to>=current_date-90
    and nullif(trim(p.brand),'') is not null
    and public.product_quantity_key(coalesce(p.quantity_text,o.title)) is not null
  order by o.product_id,o.store_id,o.valid_to desc,o.updated_at desc
), pairs as (
  select a.product_id product_id_a,b.product_id product_id_b,
         a.product_name product_name_a,b.product_name product_name_b,a.brand,a.quantity_key,
         a.store_name store_a,b.store_name store_b,a.offer_title offer_title_a,b.offer_title offer_title_b,
         greatest(a.valid_to,b.valid_to) latest_valid_to
  from recent a
  join recent b on a.brand_key=b.brand_key and a.quantity_key=b.quantity_key
   and a.product_id::text<b.product_id::text and a.store_id<>b.store_id
)
select distinct p.product_id_a,p.product_id_b,p.product_name_a,p.product_name_b,p.brand,p.quantity_key,
       p.store_a,p.store_b,p.offer_title_a,p.offer_title_b,p.latest_valid_to,
       'manual_review_required'::text review_status
from pairs p
where not exists (
  select 1 from public.product_equivalences e
  where least(e.product_id_a,e.product_id_b)=least(p.product_id_a,p.product_id_b)
    and greatest(e.product_id_a,e.product_id_b)=greatest(p.product_id_a,p.product_id_b)
);

revoke all on public.product_equivalence_review_queue from anon, authenticated;
