create index if not exists web_push_deliveries_subscription_idx
  on public.web_push_deliveries(subscription_id, status, created_at desc);
