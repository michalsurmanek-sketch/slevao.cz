-- Classify structured products from official source taxonomy instead of exact product-title exceptions.

create or replace function public.infer_product_filter_group_source_category_v33(
  p_store_slug text,
  p_category_root text,
  p_category_path text
)
returns text
language plpgsql
stable
parallel safe
set search_path to 'public','pg_temp'
as $$
declare
  v_store text := lower(trim(coalesce(p_store_slug,'')));
  v_root text := public.normalize_text(coalesce(p_category_root,''));
  v_path text := public.normalize_text(coalesce(p_category_path,''));
begin
  if v_root='' then return 'other'; end if;

  if v_root ~ '^(potraviny|jidlo)$' then return 'food'; end if;
  if v_root ~ '^(napoje|nealkoholicke napoje)$' then return 'drinks'; end if;
  if v_root ~ '^(kosmetika|drogerie|hygiena)$' then return 'drugstore'; end if;
  if v_root ~ '^(veterina|chovatelske potreby|potreby pro zvirata)$' then return 'pets'; end if;

  if v_root ~ '^(vitaminy a mineraly|vitaminy mineralni latky a elektrolyty|doplnky stravy|leky|leciva|zdravi|zdravotnicke potreby|zdravotnicke prostredky|homeopatie)$' then
    return 'pharmacy';
  end if;

  -- Pilulka has a mixed parent branch. Decide only from deeper official taxonomy,
  -- never from a concrete product title.
  if v_store='pilulka' and v_root='maminky a deti' then
    if v_path ~ '(^| )(prikrmy|presnidavky|kapsicky|detske kase|mlecne kase|kojenecka mleka|pocatecni mleka|pokracovaci mleka|detska vyziva|potraviny pro deti)( |$)' then return 'food'; end if;
    if v_path ~ '(^| )(detske napoje|napoje pro deti|detske caje|caje pro deti|detske stavy|stavy pro deti)( |$)' then return 'drinks'; end if;
    if v_path ~ '(^| )(pleny|prebalovani|vlhcene ubrousky|detska kosmetika|detska hygiena|koupani deti)( |$)' then return 'drugstore'; end if;
    if v_path ~ '(^| )(vitaminy pro deti|doplnky stravy pro deti|vitaminy pro tehotne|doplnky pro tehotne)( |$)' then return 'pharmacy'; end if;
  end if;

  return 'other';
end;
$$;

-- Keep historical source rules for other stores, but do not let old Pilulka
-- exact-title rules participate in the active classifier anymore.
create or replace function public.infer_product_filter_group_source_rules_v33(
  p_name text,
  p_quantity_text text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
parallel safe
set search_path to 'public','pg_temp'
as $$
begin
  if lower(coalesce(p_metadata->>'source_store_slug',''))='pilulka' then
    return 'other';
  end if;
  return public.infer_product_filter_group_source_rules(p_name,p_quantity_text,p_metadata);
end;
$$;

create or replace function public.product_filter_group_classifier_version()
returns integer
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$ select 33 $$;

create or replace function public.auto_assign_product_filter_group()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_inferred text;
  v_version integer := public.product_filter_group_classifier_version();
  v_old_auto boolean := false;
  v_new_auto boolean := false;
  v_explicit_change boolean := false;
  v_source_category boolean := false;
begin
  v_new_auto := coalesce(new.metadata->>'filter_group_source','')='auto_classifier';

  if tg_op='UPDATE' then
    v_old_auto := coalesce(old.metadata->>'filter_group_source','')='auto_classifier';
    v_explicit_change := new.filter_group is distinct from old.filter_group;
  end if;

  if v_explicit_change then
    new.metadata := (coalesce(new.metadata,'{}'::jsonb) - 'filter_group_classifier_version')
      || jsonb_build_object(
        'filter_group_source','explicit',
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    return new;
  end if;

  if coalesce(nullif(trim(new.filter_group),''),'other')='other' or v_old_auto or v_new_auto then
    v_inferred := public.infer_product_filter_group_source_category_v33(
      new.metadata->>'source_store_slug',
      new.metadata->>'source_category_root',
      new.metadata->>'source_category_path'
    );
    v_source_category := v_inferred <> 'other';

    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_high_confidence(new.name,new.quantity_text);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_source_rules_v33(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_activity_v28(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_remainder_v29(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_verified_v30(new.name,new.quantity_text,new.metadata);
    end if;
    if v_inferred='other' then
      v_inferred := public.infer_product_filter_group_auto(new.name,new.category_id,new.quantity_text,new.metadata);
    end if;

    if v_inferred <> 'other' then
      new.filter_group := v_inferred;
      if v_source_category then new.classification_source := 'source-category-v33'; end if;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_source','auto_classifier',
        'filter_group_classifier_version',v_version,
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
    else
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'filter_group_classifier_checked_version',v_version,
        'filter_group_classifier_checked_at',now()
      );
      if v_old_auto or v_new_auto then
        new.filter_group := 'other';
        new.metadata := new.metadata || jsonb_build_object(
          'filter_group_source','auto_classifier',
          'filter_group_classifier_version',v_version
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.propagate_structured_product_source_category(
  p_store_slug text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $$
declare
  v_updated integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Structured rows must be a JSON array.';
  end if;

  with source_rows as (
    select
      item->>'external_id' as external_id,
      nullif(trim(item->'metadata'->>'source_category_root'),'') as category_root,
      nullif(trim(item->'metadata'->>'source_category_path'),'') as category_path,
      item->'metadata'->'source_category_items' as category_items,
      nullif(trim(item->'metadata'->>'source_category_source'),'') as category_source
    from jsonb_array_elements(p_rows) item
    where nullif(trim(item->>'external_id'),'') is not null
      and nullif(trim(item->'metadata'->>'source_category_root'),'') is not null
      and nullif(trim(item->'metadata'->>'source_category_path'),'') is not null
      and item->'metadata'->'source_category_items' is not null
      and nullif(trim(item->'metadata'->>'source_category_source'),'') is not null
  ), prepared as (
    select s.*,
      public.infer_product_filter_group_source_category_v33(
        p_store_slug,s.category_root,s.category_path
      ) as inferred_group
    from source_rows s
  )
  update public.products p
  set metadata = coalesce(p.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'source_category_root',s.category_root,
        'source_category_path',s.category_path,
        'source_category_items',s.category_items,
        'source_category_source',s.category_source
      )
      || case
          when coalesce(p.metadata->>'filter_group_source','') <> 'explicit' and s.inferred_group <> 'other'
          then jsonb_build_object('filter_group_source','auto_classifier')
          else '{}'::jsonb
        end,
      classification_source = case
        when coalesce(p.metadata->>'filter_group_source','') <> 'explicit' and s.inferred_group <> 'other'
        then 'source-category-v33'
        else p.classification_source
      end,
      updated_at = now()
  from prepared s
  where lower(coalesce(p.metadata->>'source_store_slug',''))=lower(trim(coalesce(p_store_slug,'')))
    and coalesce(p.metadata->>'structured_identity_key',p.metadata->>'structured_external_id','')=s.external_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.publish_structured_store_offers_with_source_category(
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
set search_path to 'public','private','extensions','pg_temp'
set statement_timeout to '180s'
as $$
declare
  v_result jsonb;
  v_propagated integer;
begin
  v_result := public.publish_structured_store_offers(
    p_store_slug,p_adapter,p_signature,p_rows,p_min_products,p_max_products,
    p_source_document_url,p_parser_version
  );
  v_propagated := private.propagate_structured_product_source_category(p_store_slug,p_rows);
  return v_result || jsonb_build_object('source_category_products_updated',v_propagated);
end;
$$;

revoke all on function public.publish_structured_store_offers_with_source_category(text,text,text,jsonb,integer,integer,text,text) from public;
revoke all on function public.publish_structured_store_offers_with_source_category(text,text,text,jsonb,integer,integer,text,text) from anon;
revoke all on function public.publish_structured_store_offers_with_source_category(text,text,text,jsonb,integer,integer,text,text) from authenticated;
grant execute on function public.publish_structured_store_offers_with_source_category(text,text,text,jsonb,integer,integer,text,text) to service_role;

-- One canonical Pilulka importer. Remove the legacy two-step DB route so it cannot
-- bypass official source-category metadata on a later run.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in ('sync_pilulka_products_daily','sync_pilulka_products_apply_daily','sync-pilulka-verified-products')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'sync-pilulka-verified-products',
    '55 3 * * *',
    $cron$
      select net.http_post(
        url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-pilulka-products',
        headers := jsonb_build_object(
          'content-type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='slevao_cron_secret' limit 1)
        ),
        body := '{"dry_run":false}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cron$
  );
end;
$$;
