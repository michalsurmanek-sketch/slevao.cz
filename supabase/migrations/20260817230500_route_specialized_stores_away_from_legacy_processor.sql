create or replace function public.dispatch_queued_leaflet_imports(batch_size integer default 3)
returns integer
language plpgsql
security definer
set search_path to 'public','extensions','vault'
as $function$
declare
  item record;
  cron_secret text;
  dispatched integer := 0;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(cron_secret,'')='' then
    raise exception 'Missing vault secret slevao_cron_secret';
  end if;

  for item in
    select li.id
    from public.leaflet_imports li
    join public.stores s on s.id = li.store_id
    where li.status='queued'
      and coalesce(li.metadata->>'product_batch_key','')=''
      and (li.started_at is null or li.started_at < now()-interval '10 minutes')
      and s.slug not in ('billa','albert','tesco')
    order by li.created_at asc
    limit greatest(1,least(coalesce(batch_size,3),10))
    for update of li skip locked
  loop
    update public.leaflet_imports
    set started_at=now(), error_message=null
    where id=item.id;

    perform net.http_post(
      url:='https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/process-leaflet',
      headers:=jsonb_build_object('content-type','application/json','x-cron-secret',cron_secret),
      body:=jsonb_build_object('import_id',item.id),
      timeout_milliseconds:=10000
    );
    dispatched:=dispatched+1;
  end loop;

  return dispatched;
end;
$function$;
