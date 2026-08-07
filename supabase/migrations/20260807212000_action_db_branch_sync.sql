create table if not exists public.branch_sync_http_batch (
  source text not null,
  external_key text not null,
  url text not null,
  request_id bigint not null,
  requested_at timestamptz not null default now(),
  primary key (source, external_key)
);
revoke all on table public.branch_sync_http_batch from public, anon, authenticated;
grant select, insert, update, delete on table public.branch_sync_http_batch to service_role;

create or replace function public.parse_action_branch_from_response(p_request_id bigint, p_detail_url text)
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
with response as (
  select r.content
  from net._http_response r
  where r.id=p_request_id
    and r.status_code=200
    and coalesce(r.timed_out,false)=false
    and r.error_msg is null
), scripts as (
  select m[1]::jsonb as j, content
  from response,
       regexp_matches(content,'<script type="application/ld[+]json">([^<]+)</script>','g') m
), store_json as (
  select j,content
  from scripts
  where j->>'@type'='Store'
  limit 1
), normalized as (
  select
    substring(content from '\\"storeId\\":\\"([^\\"]+)\\"') as store_id,
    j
  from store_json
)
select
  'action:' || n.store_id as external_id,
  'Action ' || coalesce(nullif(n.j->>'name',''),n.store_id) as name,
  n.j->'address'->>'streetAddress' as street,
  n.j->'address'->'addressLocality'->>'city' as city,
  n.j->'address'->'postalCode'->>'postalCode' as postal_code,
  null::text as region,
  (n.j->'geo'->>'latitude')::double precision as latitude,
  (n.j->'geo'->>'longitude')::double precision as longitude,
  true as is_active,
  jsonb_build_object(
    'source','action.com',
    'store_id',n.store_id,
    'detail_url',p_detail_url,
    'weekly',n.j->'openingHours'
  ) as opening_hours
from normalized n
where n.store_id ~ '^[A-Z0-9-]+$'
  and nullif(n.j->'address'->>'streetAddress','') is not null
  and nullif(n.j->'address'->'addressLocality'->>'city','') is not null
  and nullif(n.j->'address'->'postalCode'->>'postalCode','') is not null
  and (n.j->'geo'->>'latitude')::double precision between 48.45 and 51.2
  and (n.j->'geo'->>'longitude')::double precision between 12 and 19.1
  and jsonb_array_length(coalesce(n.j->'openingHours','[]'::jsonb))=7;
$fn$;

revoke all on function public.parse_action_branch_from_response(bigint,text) from public, anon, authenticated;
grant execute on function public.parse_action_branch_from_response(bigint,text) to service_role;

create or replace function public.request_action_sitemap_source()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare v_request_id bigint;
begin
  select net.http_get(
    url:='https://www.action.com/cs-cz/store-sitemap.xml',
    headers:='{"User-Agent":"Mozilla/5.0","Accept":"application/xml,text/xml,*/*"}'::jsonb,
    timeout_milliseconds:=30000
  ) into v_request_id;

  insert into public.branch_sync_http_state(source,request_id,requested_at)
  values('action-sitemap',v_request_id,now())
  on conflict(source) do update set request_id=excluded.request_id,requested_at=excluded.requested_at;
  return v_request_id;
end;
$fn$;

revoke all on function public.request_action_sitemap_source() from public, anon, authenticated;
grant execute on function public.request_action_sitemap_source() to service_role;

create or replace function public.queue_latest_action_branch_details()
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare
  v_request_id bigint;
  v_requested_at timestamptz;
  v_status integer;
  v_timed_out boolean;
  v_error text;
  v_count integer:=0;
  rec record;
  v_detail_request bigint;
begin
  select request_id,requested_at into v_request_id,v_requested_at
  from public.branch_sync_http_state where source='action-sitemap';
  if v_request_id is null then raise exception 'Action sitemap request nebyl spuštěn'; end if;
  if v_requested_at<now()-interval '20 minutes' then raise exception 'Action sitemap request % je příliš starý',v_request_id; end if;

  select status_code,coalesce(timed_out,false),error_msg into v_status,v_timed_out,v_error
  from net._http_response where id=v_request_id;
  if v_status is null then raise exception 'Action sitemap response % ještě není dostupný',v_request_id; end if;
  if v_status<>200 or v_timed_out or v_error is not null then
    raise exception 'Action sitemap response není validní: status %, timeout %, error %',v_status,v_timed_out,v_error;
  end if;

  delete from public.branch_sync_http_batch where source='action';

  for rec in
    with src as (select content from net._http_response where id=v_request_id), urls as (
      select distinct m[1] as url
      from src, regexp_matches(content,'<loc>(https://www[.]action[.]com/cs-cz/prodejny/[^<]*)</loc>','g') m
    )
    select url,
           regexp_replace(url,'^https://www[.]action[.]com/cs-cz/prodejny/([^/]+)/?$','\1') as slug
    from urls
    where url<>'https://www.action.com/cs-cz/prodejny/'
      and url not like '%/prodejny/l/%'
      and url<>'https://www.action.com/cs-cz/prodejny/Trebic/'
    order by url
  loop
    select net.http_get(
      url:=rec.url,
      headers:='{"User-Agent":"Mozilla/5.0","Accept":"text/html,application/xhtml+xml"}'::jsonb,
      timeout_milliseconds:=30000
    ) into v_detail_request;

    insert into public.branch_sync_http_batch(source,external_key,url,request_id,requested_at)
    values('action',rec.slug,rec.url,v_detail_request,now())
    on conflict(source,external_key) do update set
      url=excluded.url,request_id=excluded.request_id,requested_at=excluded.requested_at;
    v_count:=v_count+1;
  end loop;

  if v_count<100 or v_count>120 then raise exception 'Action sitemap obsahuje neočekávaných % aktivních detailů',v_count; end if;
  return jsonb_build_object('ok',true,'source','action','queued',v_count,'sitemap_request_id',v_request_id,'ignored_stale_url','https://www.action.com/cs-cz/prodejny/Trebic/');
end;
$fn$;

revoke all on function public.queue_latest_action_branch_details() from public, anon, authenticated;
grant execute on function public.queue_latest_action_branch_details() to service_role;

create or replace function public.apply_latest_action_branch_details(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare
  v_batch_count integer;
  v_ready_count integer;
  v_parsed_count integer;
  v_unique_count integer;
  v_store_id uuid;
  v_written integer:=0;
  v_oldest timestamptz;
begin
  select count(*),min(requested_at) into v_batch_count,v_oldest
  from public.branch_sync_http_batch where source='action';
  if v_batch_count<100 or v_batch_count>120 then raise exception 'Action detail batch má neočekávaných % položek',v_batch_count; end if;
  if v_oldest<now()-interval '30 minutes' then raise exception 'Action detail batch je příliš starý'; end if;

  select count(*) into v_ready_count
  from public.branch_sync_http_batch b
  join net._http_response r on r.id=b.request_id
  where b.source='action' and r.status_code=200 and coalesce(r.timed_out,false)=false and r.error_msg is null;
  if v_ready_count<>v_batch_count then raise exception 'Action detail responses nejsou kompletní: ready %, batch %',v_ready_count,v_batch_count; end if;

  with parsed as (
    select p.*
    from public.branch_sync_http_batch b
    cross join lateral public.parse_action_branch_from_response(b.request_id,b.url) p
    where b.source='action'
  )
  select count(*),count(distinct external_id) into v_parsed_count,v_unique_count from parsed;

  if v_parsed_count<>v_batch_count or v_unique_count<>v_parsed_count then
    raise exception 'Action parser není kompletní: batch %, parsed %, unique %',v_batch_count,v_parsed_count,v_unique_count;
  end if;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,'source','action_official','batch',v_batch_count,'parsed',v_parsed_count,'written',0);
  end if;

  select id into v_store_id from public.stores where slug='action' and is_active=true limit 1;
  if v_store_id is null then raise exception 'Aktivní obchod action nebyl nalezen'; end if;

  insert into public.branches(store_id,external_id,name,street,city,postal_code,region,latitude,longitude,is_active,opening_hours)
  select v_store_id,p.external_id,p.name,p.street,p.city,p.postal_code,p.region,p.latitude,p.longitude,p.is_active,p.opening_hours
  from public.branch_sync_http_batch b
  cross join lateral public.parse_action_branch_from_response(b.request_id,b.url) p
  where b.source='action'
  on conflict(store_id,external_id) do update set
    name=excluded.name,street=excluded.street,city=excluded.city,postal_code=excluded.postal_code,region=excluded.region,
    latitude=excluded.latitude,longitude=excluded.longitude,is_active=excluded.is_active,opening_hours=excluded.opening_hours,updated_at=now();
  get diagnostics v_written=row_count;

  return jsonb_build_object('ok',true,'dry_run',false,'source','action_official','batch',v_batch_count,'parsed',v_parsed_count,'written',v_written);
end;
$fn$;

revoke all on function public.apply_latest_action_branch_details(boolean) from public, anon, authenticated;
grant execute on function public.apply_latest_action_branch_details(boolean) to service_role;
