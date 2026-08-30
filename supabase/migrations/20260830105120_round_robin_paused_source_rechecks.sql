create or replace function public.recheck_paused_leaflet_sources(p_limit integer default 4)
returns integer
language plpgsql
security definer
set search_path to 'public','vault'
as $function$
declare
  cron_secret text;
  queued integer:=0;
  candidate record;
begin
  p_limit:=greatest(1,least(coalesce(p_limit,4),10));
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  limit 1;
  if coalesce(cron_secret,'')='' then return 0; end if;

  for candidate in
    select s.slug,
           max(ls.last_checked_at) as last_store_check
    from public.leaflet_sources ls
    join public.stores s on s.id=ls.store_id
    where ls.automation_mode in ('web_only','blocked','paused')
      and s.is_active=true
    group by s.slug
    order by max(ls.last_checked_at) asc nulls first,s.slug
    limit p_limit
  loop
    perform net.http_post(
      url:='https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/sync-official-leaflet-sources',
      headers:=jsonb_build_object('content-type','application/json','x-cron-secret',cron_secret),
      body:=jsonb_build_object('store_slug',candidate.slug,'limit',1,'force',true),
      timeout_milliseconds:=120000
    );
    queued:=queued+1;
  end loop;
  return queued;
end;
$function$;

update public.leaflet_sources
set next_review_at=null
where automation_mode in ('web_only','blocked','paused')
  and next_review_at is not null;
