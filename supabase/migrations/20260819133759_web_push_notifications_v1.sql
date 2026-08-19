create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  user_agent text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_subscriptions_endpoint_https_chk check (endpoint ~ '^https://'),
  constraint web_push_subscriptions_p256dh_chk check (length(p256dh) between 40 and 256),
  constraint web_push_subscriptions_auth_chk check (length(auth) between 8 and 128)
);

create index web_push_subscriptions_user_active_idx
  on public.web_push_subscriptions(user_id, is_active, updated_at desc);

alter table public.web_push_subscriptions enable row level security;
revoke all on table public.web_push_subscriptions from public, anon, authenticated;
grant all on table public.web_push_subscriptions to service_role;

create table public.web_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sent','failed','gone')),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);

create index web_push_deliveries_notification_idx
  on public.web_push_deliveries(notification_id, status);

alter table public.web_push_deliveries enable row level security;
revoke all on table public.web_push_deliveries from public, anon, authenticated;
grant all on table public.web_push_deliveries to service_role;

create or replace function public.web_push_get_vapid_keys()
returns table(public_key text, private_key text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select
    (
      select ds.decrypted_secret
      from vault.decrypted_secrets ds
      where ds.name='slevao_web_push_vapid_public'
      order by ds.created_at desc
      limit 1
    )::text as public_key,
    (
      select ds.decrypted_secret
      from vault.decrypted_secrets ds
      where ds.name='slevao_web_push_vapid_private'
      order by ds.created_at desc
      limit 1
    )::text as private_key;
$$;

revoke all on function public.web_push_get_vapid_keys() from public;
revoke execute on function public.web_push_get_vapid_keys() from anon, authenticated;
grant execute on function public.web_push_get_vapid_keys() to service_role;

create or replace function public.web_push_store_vapid_keys(p_public_key text, p_private_key text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_public text;
  v_private text;
begin
  if coalesce(p_public_key,'') !~ '^[A-Za-z0-9_-]{60,120}$'
     or coalesce(p_private_key,'') !~ '^[A-Za-z0-9_-]{30,80}$' then
    raise exception 'Invalid VAPID key format.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('slevao:web-push-vapid',0));

  select public_key,private_key
  into v_public,v_private
  from public.web_push_get_vapid_keys();

  if v_public is not null and v_private is not null then
    return;
  end if;

  if (v_public is null) <> (v_private is null) then
    raise exception 'Incomplete VAPID configuration already exists.';
  end if;

  perform vault.create_secret(p_public_key,'slevao_web_push_vapid_public','SLEVAO Web Push VAPID public key');
  perform vault.create_secret(p_private_key,'slevao_web_push_vapid_private','SLEVAO Web Push VAPID private key');
end;
$$;

revoke all on function public.web_push_store_vapid_keys(text,text) from public;
revoke execute on function public.web_push_store_vapid_keys(text,text) from anon, authenticated;
grant execute on function public.web_push_store_vapid_keys(text,text) to service_role;

create or replace function public.dispatch_notification_web_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  v_cron_secret text;
  v_request_id bigint;
begin
  if not exists (
    select 1
    from public.web_push_subscriptions s
    where s.user_id=new.user_id and s.is_active=true
  ) then
    return new;
  end if;

  select ds.decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets ds
  where ds.name='slevao_cron_secret'
  order by ds.created_at desc
  limit 1;

  if coalesce(v_cron_secret,'')='' then
    raise warning 'Web Push dispatch skipped: slevao_cron_secret is missing.';
    return new;
  end if;

  select net.http_post(
    url := 'https://uhampjdqjxmbhaptgitn.supabase.co/functions/v1/web-push',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_cron_secret),
    body := jsonb_build_object('action','dispatch','notification_id',new.id),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return new;
exception when others then
  raise warning 'Web Push dispatch enqueue failed for notification %: %',new.id,sqlerrm;
  return new;
end;
$$;

revoke all on function public.dispatch_notification_web_push() from public;
revoke execute on function public.dispatch_notification_web_push() from anon, authenticated;
grant execute on function public.dispatch_notification_web_push() to service_role;

drop trigger if exists notifications_dispatch_web_push on public.notifications;
create trigger notifications_dispatch_web_push
after insert on public.notifications
for each row execute function public.dispatch_notification_web_push();
