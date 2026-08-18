do $guard$
declare
  v_revision_def text;
  v_full_def text;
begin
  select pg_get_functiondef('public.get_shared_shopping_list_revision(text)'::regprocedure)
  into v_revision_def;
  select pg_get_functiondef('public.get_shared_shopping_list(text)'::regprocedure)
  into v_full_def;

  if position('extract(epoch from v_max_updated)::bigint' in v_revision_def)=0
     or position('extract(epoch from v_max_created)::bigint' in v_revision_def)=0
     or position('extract(epoch from v_max_updated)::bigint' in v_full_def)=0
     or position('extract(epoch from v_max_created)::bigint' in v_full_def)=0 then
    raise exception 'Shared-list revision functions drifted from the expected bigint epoch implementation.';
  end if;
end
$guard$;

create or replace function public.get_shared_shopping_list_revision(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share record;
  v_count bigint;
  v_max_updated timestamptz;
  v_max_created timestamptz;
  v_revision text;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;

  select count(*)::bigint,max(updated_at),max(created_at)
    into v_count,v_max_updated,v_max_created
  from public.shopping_list_items
  where shopping_list_id=v_share.shopping_list_id;

  v_revision := concat_ws(':',
    v_count::text,
    coalesce(extract(epoch from v_max_updated)::text,'0'),
    coalesce(extract(epoch from v_max_created)::text,'0')
  );

  return jsonb_build_object(
    'list_id',v_share.shopping_list_id,
    'permission',v_share.permission,
    'item_count',v_count,
    'updated_at',v_max_updated,
    'revision',v_revision
  );
end;
$$;

create or replace function public.get_shared_shopping_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share record;
  v_result jsonb;
  v_count bigint;
  v_max_updated timestamptz;
  v_max_created timestamptz;
  v_revision text;
begin
  select * into v_share from public.resolve_shopping_list_share(p_token);
  if v_share.shopping_list_id is null then
    raise exception 'Sdílený seznam neexistuje, vypršel nebo byl zrušen.';
  end if;

  update public.shopping_list_shares set last_accessed_at=now() where id=v_share.share_id;

  select count(*)::bigint,max(updated_at),max(created_at)
    into v_count,v_max_updated,v_max_created
  from public.shopping_list_items
  where shopping_list_id=v_share.shopping_list_id;

  v_revision := concat_ws(':',
    v_count::text,
    coalesce(extract(epoch from v_max_updated)::text,'0'),
    coalesce(extract(epoch from v_max_created)::text,'0')
  );

  select jsonb_build_object(
    'list_id',v_share.shopping_list_id,
    'name',v_share.list_name,
    'permission',v_share.permission,
    'budget',sl.budget,
    'revision',v_revision,
    'updated_at',v_max_updated,
    'item_count',v_count,
    'items',coalesce(jsonb_agg(
      jsonb_build_object(
        'id',i.id,
        'product_id',i.product_id,
        'selected_offer_id',i.selected_offer_id,
        'custom_name',i.custom_name,
        'quantity',i.quantity,
        'unit',i.unit,
        'is_completed',i.is_completed,
        'created_at',i.created_at,
        'updated_at',i.updated_at,
        'name',coalesce(p.name,i.custom_name,'Položka'),
        'brand',p.brand,
        'quantity_text',p.quantity_text,
        'image_url',p.image_url
      ) order by i.created_at
    ) filter(where i.id is not null),'[]'::jsonb)
  ) into v_result
  from public.shopping_lists sl
  left join public.shopping_list_items i on i.shopping_list_id=sl.id
  left join public.products p on p.id=i.product_id
  where sl.id=v_share.shopping_list_id
  group by sl.id;

  return v_result;
end;
$$;
