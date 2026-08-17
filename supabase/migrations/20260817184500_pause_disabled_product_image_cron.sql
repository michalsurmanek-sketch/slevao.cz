-- The smart product-image automation is intentionally disabled while the external
-- image-discovery provider has no available credit. Do not keep invoking a no-op
-- Edge Function every minute in that state.
do $$
begin
  if exists (select 1 from cron.job where jobname='slevao-auto-product-images') then
    perform cron.unschedule('slevao-auto-product-images');
  end if;
end $$;
