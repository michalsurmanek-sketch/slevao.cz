update public.store_product_sync_state st
set last_offer_count=last_offer_count
where st.store_id=(select id from public.stores where slug='flop' limit 1)
  and st.health_status='ok'
  and st.last_error is null;
