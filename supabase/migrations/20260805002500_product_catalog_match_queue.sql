alter table public.offers
  add column if not exists catalog_checked_at timestamptz,
  add column if not exists catalog_match_status text,
  add column if not exists catalog_match_score numeric(6,5);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='offers_catalog_match_status_check'
      and conrelid='public.offers'::regclass
  ) then
    alter table public.offers
      add constraint offers_catalog_match_status_check
      check (catalog_match_status is null or catalog_match_status in ('matched','retained','needs_review','failed'));
  end if;
end;
$$;

create index if not exists offers_catalog_match_queue_idx
on public.offers(published_at desc)
where status='published' and catalog_checked_at is null;

create or replace function public.reset_offer_catalog_match_on_identity_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.title is distinct from old.title
     or new.store_id is distinct from old.store_id then
    new.catalog_checked_at:=null;
    new.catalog_match_status:=null;
    new.catalog_match_score:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_offer_catalog_match_on_identity_change on public.offers;
create trigger trg_reset_offer_catalog_match_on_identity_change
before update of title,store_id on public.offers
for each row execute function public.reset_offer_catalog_match_on_identity_change();

create or replace function public.queue_product_catalog_matching(p_limit integer default 40)
returns bigint
language plpgsql
security definer
set search_path=public,vault
as $$
declare
  cron_secret text;
begin
  p_limit:=greatest(1,least(coalesce(p_limit,40),80));
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets
  where name='slevao_cron_secret'
  limit 1;
  if coalesce(cron_secret,'')='' then return null; end if;

  if not exists(
    select 1 from public.offers
    where status='published' and catalog_checked_at is null
  ) then
    return null;
  end if;

  return net.http_post(
    url:='https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/match-product-catalog',
    headers:=jsonb_build_object('content-type','application/json','x-cron-secret',cron_secret),
    body:=jsonb_build_object('limit',p_limit),
    timeout_milliseconds:=5000
  );
end;
$$;

revoke all on function public.queue_product_catalog_matching(integer) from public;
grant execute on function public.queue_product_catalog_matching(integer) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='product-catalog-match-queue') then
    perform cron.unschedule('product-catalog-match-queue');
  end if;
end;
$$;

select cron.schedule(
  'product-catalog-match-queue',
  '*/20 * * * *',
  $job$select public.queue_product_catalog_matching(40);$job$
);