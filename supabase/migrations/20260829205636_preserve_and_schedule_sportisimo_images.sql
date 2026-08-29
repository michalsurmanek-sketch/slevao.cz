create or replace function public.preserve_sportisimo_offer_image()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_catalog'
as $function$
declare
  v_existing text;
begin
  if coalesce(new.image_url,'')=''
     and new.external_id is not null
     and exists (select 1 from public.stores s where s.id=new.store_id and s.slug='sportisimo')
  then
    if tg_op='UPDATE' and coalesce(old.image_url,'')<>'' then
      new.image_url:=old.image_url;
    else
      select o.image_url
      into v_existing
      from public.offers o
      where o.store_id=new.store_id
        and o.external_id=new.external_id
        and coalesce(o.image_url,'')<>''
      order by o.updated_at desc
      limit 1;
      if coalesce(v_existing,'')<>'' then new.image_url:=v_existing; end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_preserve_sportisimo_offer_image on public.offers;
create trigger trg_preserve_sportisimo_offer_image
before insert or update of image_url,external_id,store_id on public.offers
for each row execute function public.preserve_sportisimo_offer_image();

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='enrich-sportisimo-images'
  loop perform cron.unschedule(r.jobid); end loop;
end $$;

select cron.schedule(
  'enrich-sportisimo-images',
  '27 * * * *',
  $job$select private.invoke_edge_function('enrich-sportisimo-images', jsonb_build_object('dry_run',false,'limit',12), 120000);$job$
);
