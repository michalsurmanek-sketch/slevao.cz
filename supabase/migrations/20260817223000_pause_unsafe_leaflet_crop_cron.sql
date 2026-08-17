-- Safety pause: leaflet crop candidates must be approved before becoming public offer images.
-- The crop worker is paused until generate-leaflet-product-crops is rebuilt around
-- product_image_candidates -> approved -> apply_approved_product_image().

select cron.unschedule('leaflet-crop-backfill');
