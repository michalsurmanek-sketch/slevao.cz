do $body$
declare
  v_count integer;
  v_unique integer;
  v_missing_gps integer;
  v_missing_city integer;
begin
  select count(b.id)::int,
         count(distinct b.external_id)::int,
         count(*) filter (where b.latitude is null or b.longitude is null)::int,
         count(*) filter (where nullif(trim(b.city),'') is null)::int
    into v_count, v_unique, v_missing_gps, v_missing_city
  from branches b
  join stores s on s.id=b.store_id
  where s.slug='coop';

  if v_count < 300 or v_count <> v_unique or v_missing_gps <> 0 or v_missing_city <> 0 then
    raise exception 'COOP branch integrity guard failed: count %, unique %, missing_gps %, missing_city %', v_count, v_unique, v_missing_gps, v_missing_city;
  end if;

  perform cron.schedule(
    'sync-coop-branches',
    '50 3 * * 0',
    $job$select public.invoke_coop_branch_sync(false);$job$
  );
end;
$body$;