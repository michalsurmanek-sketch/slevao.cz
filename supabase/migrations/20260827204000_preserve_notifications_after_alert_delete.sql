-- Deleting a price alert should stop future checks, not erase historical notifications.

alter table public.notifications
  drop constraint if exists notifications_price_alert_id_fkey;

alter table public.notifications
  add constraint notifications_price_alert_id_fkey
  foreign key (price_alert_id)
  references public.price_alerts(id)
  on delete set null;
