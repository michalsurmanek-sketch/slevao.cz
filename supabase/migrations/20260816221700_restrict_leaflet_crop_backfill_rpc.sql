-- Restrict internal leaflet crop backfill queue to trusted roles only.
-- The production cron invokes this function internally; browser roles must not call it.

revoke execute on function public.queue_leaflet_crop_backfill_guarded(integer) from anon;
revoke execute on function public.queue_leaflet_crop_backfill_guarded(integer) from authenticated;
grant execute on function public.queue_leaflet_crop_backfill_guarded(integer) to service_role;
