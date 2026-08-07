create or replace function public.parse_kik_branches_from_response(p_request_id bigint)
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
with results as (
  select value as s
  from net._http_response r,
       jsonb_each(r.content::jsonb->'stores'->0->'results')
  where r.id=p_request_id
    and r.status_code=200
    and coalesce(r.timed_out,false)=false
    and r.error_msg is null
), normalized as (
  select
    trim(s->>'filiale') as filiale,
    trim(s->>'address') as street,
    trim(s->>'city') as city,
    trim(s->>'zip') as postal_code,
    (s->>'latitude')::double precision as latitude,
    (s->>'longitude')::double precision as longitude,
    nullif(trim(s->>'phone'),'') as phone,
    coalesce((s->>'omni_channel')::boolean,false) as omni_channel,
    nullif((s->>'opening_date')::bigint,0) as opening_epoch,
    coalesce(s->>'opening_times','') as opening_times
  from results
), weekly as (
  select
    n.filiale,
    jsonb_agg(
      jsonb_build_object(
        'day', trim(split_part(item,':',1)),
        'hours', trim(substr(item,strpos(item,':')+1))
      ) order by ord
    ) as hours,
    count(*) as hour_count
  from normalized n
  cross join lateral unnest(string_to_array(n.opening_times,'*')) with ordinality as t(item,ord)
  group by n.filiale
)
select
  'kik:' || n.filiale as external_id,
  'KiK ' || n.city || ' – ' || n.street as name,
  n.street,
  n.city,
  n.postal_code,
  null::text as region,
  n.latitude,
  n.longitude,
  true as is_active,
  jsonb_build_object(
    'source','storefinder-microservice.kik.de',
    'filiale',n.filiale,
    'phone',n.phone,
    'omni_channel',n.omni_channel,
    'opening_date',case when n.opening_epoch is null then null else to_timestamp(n.opening_epoch) end,
    'weekly',w.hours
  ) as opening_hours
from normalized n
join weekly w on w.filiale=n.filiale
where n.filiale ~ '^[0-9]+$'
  and n.street<>'' and n.city<>'' and n.postal_code<>''
  and n.latitude between 48.45 and 51.2
  and n.longitude between 12 and 19.1
  and w.hour_count=7;
$fn$;

revoke all on function public.parse_kik_branches_from_response(bigint) from public, anon, authenticated;
grant execute on function public.parse_kik_branches_from_response(bigint) to service_role;

create or replace function public.sync_kik_branches_from_response(p_request_id bigint,p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare
  v_status integer;
  v_timed_out boolean;
  v_error text;
  v_raw_count integer;
  v_parsed_count integer;
  v_unique_count integer;
  v_store_id uuid;
  v_written integer:=0;
begin
  select status_code,coalesce(timed_out,false),error_msg
  into v_status,v_timed_out,v_error
  from net._http_response where id=p_request_id;

  if v_status is null then raise exception 'KiK HTTP response % ještě není dostupný',p_request_id; end if;
  if v_status<>200 or v_timed_out or v_error is not null then
    raise exception 'KiK HTTP response % není validní: status %, timeout %, error %',p_request_id,v_status,v_timed_out,v_error;
  end if;

  select count(*) into v_raw_count
  from net._http_response r,
       jsonb_each(r.content::jsonb->'stores'->0->'results')
  where r.id=p_request_id;

  select count(*),count(distinct external_id)
  into v_parsed_count,v_unique_count
  from public.parse_kik_branches_from_response(p_request_id);

  if v_raw_count<220 or v_raw_count>280 then
    raise exception 'KiK API obsahuje neočekávaných % poboček',v_raw_count;
  end if;
  if v_parsed_count<>v_raw_count or v_unique_count<>v_parsed_count then
    raise exception 'KiK parser není kompletní: raw %, parsed %, unique %',v_raw_count,v_parsed_count,v_unique_count;
  end if;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,'source','kik_official_api','request_id',p_request_id,'raw',v_raw_count,'parsed',v_parsed_count,'written',0);
  end if;

  select id into v_store_id from public.stores where slug='kik' and is_active=true limit 1;
  if v_store_id is null then raise exception 'Aktivní obchod kik nebyl nalezen'; end if;

  insert into public.branches(store_id,external_id,name,street,city,postal_code,region,latitude,longitude,is_active,opening_hours)
  select v_store_id,p.external_id,p.name,p.street,p.city,p.postal_code,p.region,p.latitude,p.longitude,p.is_active,p.opening_hours
  from public.parse_kik_branches_from_response(p_request_id) p
  on conflict (store_id,external_id) do update set
    name=excluded.name,street=excluded.street,city=excluded.city,postal_code=excluded.postal_code,region=excluded.region,
    latitude=excluded.latitude,longitude=excluded.longitude,is_active=excluded.is_active,opening_hours=excluded.opening_hours,updated_at=now();
  get diagnostics v_written=row_count;

  return jsonb_build_object('ok',true,'dry_run',false,'source','kik_official_api','request_id',p_request_id,'raw',v_raw_count,'parsed',v_parsed_count,'written',v_written);
end;
$fn$;

revoke all on function public.sync_kik_branches_from_response(bigint,boolean) from public, anon, authenticated;
grant execute on function public.sync_kik_branches_from_response(bigint,boolean) to service_role;

create or replace function public.request_kik_branch_source()
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $fn$
declare v_request_id bigint;
begin
  select net.http_get(
    url:='https://storefinder-microservice.kik.de/storefinder/results.json?lat=49.8174&long=15.4729&country=cz&distance=500&searchlocation=null&limit=500',
    headers:='{"User-Agent":"Mozilla/5.0","Accept":"application/json"}'::jsonb,
    timeout_milliseconds:=30000
  ) into v_request_id;

  insert into public.branch_sync_http_state(source,request_id,requested_at)
  values('kik',v_request_id,now())
  on conflict(source) do update set request_id=excluded.request_id,requested_at=excluded.requested_at;
  return v_request_id;
end;
$fn$;

revoke all on function public.request_kik_branch_source() from public, anon, authenticated;
grant execute on function public.request_kik_branch_source() to service_role;

create or replace function public.apply_latest_kik_branch_source(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare v_request_id bigint; v_requested_at timestamptz;
begin
  select request_id,requested_at into v_request_id,v_requested_at
  from public.branch_sync_http_state where source='kik';

  if v_request_id is null then raise exception 'KiK source request nebyl spuštěn'; end if;
  if v_requested_at<now()-interval '20 minutes' then
    raise exception 'KiK source request % je příliš starý (%)',v_request_id,v_requested_at;
  end if;
  return public.sync_kik_branches_from_response(v_request_id,p_dry_run);
end;
$fn$;

revoke all on function public.apply_latest_kik_branch_source(boolean) from public, anon, authenticated;
grant execute on function public.apply_latest_kik_branch_source(boolean) to service_role;
