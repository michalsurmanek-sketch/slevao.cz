create table if not exists public.branch_sync_http_state (
  source text primary key,
  request_id bigint not null,
  requested_at timestamptz not null default now()
);
revoke all on table public.branch_sync_http_state from public, anon, authenticated;
grant select, insert, update on table public.branch_sync_http_state to service_role;

create or replace function public.parse_rossmann_branches_from_response(p_request_id bigint)
returns table (
  external_id text,
  name text,
  street text,
  city text,
  postal_code text,
  region text,
  latitude double precision,
  longitude double precision,
  is_active boolean,
  opening_hours jsonb
)
language sql
stable
security definer
set search_path = public, net, pg_catalog
as $fn$
with src as (
  select r.content
  from net._http_response r
  where r.id = p_request_id
    and r.status_code = 200
    and coalesce(r.timed_out,false) = false
    and r.error_msg is null
), chunks as (
  select split_part(piece,'</a>',1) as block
  from src,
       regexp_split_to_table(content, '<a href="/obsah/prodejny/') piece
  where piece like '%class="page-store--store-item%'
), base as (
  select
    lower(trim(substring(block from '^([^"/?#]+)'))) as slug,
    (substring(block from 'data-latitude="(-?[0-9]+(?:[.][0-9]+)?)"'))::double precision as latitude,
    (substring(block from 'data-longitude="(-?[0-9]+(?:[.][0-9]+)?)"'))::double precision as longitude,
    trim(substring(block from 'data-ga-address="([^"]+)"')) as ga_address,
    trim(substring(block from 'page-store--store-title">([^<]+)</div>')) as title,
    block
  from chunks
), normalized as (
  select
    slug,
    latitude,
    longitude,
    ga_address,
    title,
    trim(regexp_replace(ga_address, ',[[:space:]]*[0-9]{3}[[:space:]]?[0-9]{2}[[:space:]]+[^,]+$', '')) as street,
    substring(ga_address from ',[[:space:]]*([0-9]{3}[[:space:]]?[0-9]{2})[[:space:]]+[^,]+$') as postal_raw,
    trim(substring(ga_address from ',[[:space:]]*[0-9]{3}[[:space:]]?[0-9]{2}[[:space:]]+([^,]+)$')) as city,
    block
  from base
), hours as (
  select
    n.slug,
    jsonb_agg(
      jsonb_build_object(
        'day', regexp_replace(trim(h.m[1]), ':$', ''),
        'hours', trim(regexp_replace(h.m[2], '[[:space:]]+', ' ', 'g'))
      ) order by h.ord
    ) as weekly,
    count(*) as hours_count
  from normalized n
  cross join lateral regexp_matches(
    n.block,
    '<strong>(Po:|Út:|St:|Čt:|Pá:|So:|Ne:)</strong>[[:space:]]*([^<]+)',
    'g'
  ) with ordinality as h(m,ord)
  group by n.slug
)
select
  'rossmann:' || n.slug as external_id,
  'ROSSMANN ' || coalesce(nullif(n.title,''), n.slug) as name,
  n.street,
  n.city,
  case
    when n.postal_raw is null then null
    else substring(regexp_replace(n.postal_raw,'[[:space:]]','','g') from 1 for 3)
         || ' ' || substring(regexp_replace(n.postal_raw,'[[:space:]]','','g') from 4 for 2)
  end as postal_code,
  null::text as region,
  n.latitude,
  n.longitude,
  true as is_active,
  jsonb_build_object(
    'source','rossmann.cz',
    'canonical_slug',n.slug,
    'detail_url','https://www.rossmann.cz/obsah/prodejny/' || n.slug,
    'weekly',h.weekly
  ) as opening_hours
from normalized n
join hours h on h.slug=n.slug
where n.slug is not null and n.slug <> ''
  and n.street is not null and n.street <> ''
  and n.city is not null and n.city <> ''
  and n.postal_raw is not null
  and n.latitude between 48.45 and 51.2
  and n.longitude between 12 and 19.1
  and h.hours_count = 7;
$fn$;

revoke all on function public.parse_rossmann_branches_from_response(bigint) from public, anon, authenticated;
grant execute on function public.parse_rossmann_branches_from_response(bigint) to service_role;

create or replace function public.sync_rossmann_branches_from_response(
  p_request_id bigint,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare
  v_raw_count integer;
  v_parsed_count integer;
  v_unique_count integer;
  v_status integer;
  v_timed_out boolean;
  v_error text;
  v_store_id uuid;
  v_written integer := 0;
begin
  select r.status_code, coalesce(r.timed_out,false), r.error_msg
  into v_status, v_timed_out, v_error
  from net._http_response r
  where r.id = p_request_id;

  if v_status is null then raise exception 'Rossmann HTTP response % ještě není dostupný', p_request_id; end if;
  if v_status <> 200 or v_timed_out or v_error is not null then
    raise exception 'Rossmann HTTP response % není validní: status %, timeout %, error %', p_request_id, v_status, v_timed_out, v_error;
  end if;

  with src as (
    select content from net._http_response where id=p_request_id
  ), chunks as (
    select split_part(piece,'</a>',1) as block
    from src, regexp_split_to_table(content, '<a href="/obsah/prodejny/') piece
    where piece like '%class="page-store--store-item%'
  )
  select count(*) into v_raw_count from chunks;

  select count(*), count(distinct external_id)
  into v_parsed_count, v_unique_count
  from public.parse_rossmann_branches_from_response(p_request_id);

  if v_raw_count < 215 or v_raw_count > 240 then
    raise exception 'Rossmann locator obsahuje neočekávaných % raw poboček', v_raw_count;
  end if;
  if v_parsed_count <> v_raw_count or v_unique_count <> v_parsed_count then
    raise exception 'Rossmann parser není kompletní: raw %, parsed %, unique %', v_raw_count, v_parsed_count, v_unique_count;
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'ok',true,'dry_run',true,'source','rossmann_official_db',
      'request_id',p_request_id,'raw',v_raw_count,'parsed',v_parsed_count,'written',0
    );
  end if;

  select id into v_store_id from public.stores where slug='rossmann' and is_active=true limit 1;
  if v_store_id is null then raise exception 'Aktivní obchod rossmann nebyl nalezen'; end if;

  insert into public.branches (
    store_id, external_id, name, street, city, postal_code, region,
    latitude, longitude, is_active, opening_hours
  )
  select
    v_store_id, p.external_id, p.name, p.street, p.city, p.postal_code, p.region,
    p.latitude, p.longitude, p.is_active, p.opening_hours
  from public.parse_rossmann_branches_from_response(p_request_id) p
  on conflict (store_id,external_id) do update set
    name=excluded.name,
    street=excluded.street,
    city=excluded.city,
    postal_code=excluded.postal_code,
    region=excluded.region,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    is_active=excluded.is_active,
    opening_hours=excluded.opening_hours,
    updated_at=now();

  get diagnostics v_written = row_count;
  return jsonb_build_object(
    'ok',true,'dry_run',false,'source','rossmann_official_db',
    'request_id',p_request_id,'raw',v_raw_count,'parsed',v_parsed_count,'written',v_written
  );
end;
$fn$;

revoke all on function public.sync_rossmann_branches_from_response(bigint,boolean) from public, anon, authenticated;
grant execute on function public.sync_rossmann_branches_from_response(bigint,boolean) to service_role;

create or replace function public.request_rossmann_branch_source()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare
  v_request_id bigint;
begin
  select net.http_get(
    url := 'https://www.rossmann.cz/obsah/prodejny',
    headers := '{"User-Agent":"Mozilla/5.0","Accept":"text/html,application/xhtml+xml"}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_request_id;

  insert into public.branch_sync_http_state(source,request_id,requested_at)
  values ('rossmann',v_request_id,now())
  on conflict (source) do update set request_id=excluded.request_id, requested_at=excluded.requested_at;
  return v_request_id;
end;
$fn$;

revoke all on function public.request_rossmann_branch_source() from public, anon, authenticated;
grant execute on function public.request_rossmann_branch_source() to service_role;

create or replace function public.apply_latest_rossmann_branch_source(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_request_id bigint;
  v_requested_at timestamptz;
begin
  select request_id,requested_at into v_request_id,v_requested_at
  from public.branch_sync_http_state where source='rossmann';

  if v_request_id is null then raise exception 'Rossmann source request nebyl spuštěn'; end if;
  if v_requested_at < now() - interval '20 minutes' then
    raise exception 'Rossmann source request % je příliš starý (%).',v_request_id,v_requested_at;
  end if;
  return public.sync_rossmann_branches_from_response(v_request_id,p_dry_run);
end;
$fn$;

revoke all on function public.apply_latest_rossmann_branch_source(boolean) from public, anon, authenticated;
grant execute on function public.apply_latest_rossmann_branch_source(boolean) to service_role;

drop function if exists public.invoke_rossmann_branch_sync(boolean);
