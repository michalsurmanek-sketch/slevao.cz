-- Production image-search runs repeatedly report OpenAI billing exhaustion.
-- The existing discover-product-images-smart orchestrator checks this flag before
-- starting a cron batch, so pause only this automation instead of generating a
-- failing batch every ~30 minutes. Re-enable from the admin UI after API credit
-- is available again.
update public.product_image_automation_settings
set enabled = false,
    updated_at = now()
where id = true
  and enabled = true;
