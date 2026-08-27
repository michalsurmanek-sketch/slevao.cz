create or replace function public.sanitize_lidl_verified_title(p_title text)
returns text
language sql
immutable
parallel safe
set search_path to 'public','pg_temp'
as $$
  with cleaned as (
    select btrim(regexp_replace(coalesce(p_title,''), '^\*{0,2}\s*doporučená prodejní cena výrobce\s+', '', 'i')) as value
  )
  select case
    when value ~ '^[0-9]+([.,][0-9]+)?([[:space:]]+[0-9]+([.,][0-9]+)?)+$' then ''
    else value
  end
  from cleaned;
$$;

update public.offers
set status='expired',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'quarantined_reason','lidl_verified_numeric_pseudo_title',
      'quarantined_at',now()
    ),
    updated_at=now()
where store_id=(select id from public.stores where slug='lidl')
  and status='published'
  and metadata->>'adapter'='lidl-verified-pdf-text-v2'
  and title ~ '^[0-9]+([.,][0-9]+)?([[:space:]]+[0-9]+([.,][0-9]+)?)+$';
