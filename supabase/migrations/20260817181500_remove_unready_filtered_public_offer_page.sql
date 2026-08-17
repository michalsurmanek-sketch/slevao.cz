-- Keep production schema free of the experimental filtered public offer RPC.
-- The filtered variant did not meet the latency target and is intentionally not exposed.
drop function if exists public.get_public_offer_page_filtered(integer,integer,boolean,text,numeric,numeric,boolean,text);
