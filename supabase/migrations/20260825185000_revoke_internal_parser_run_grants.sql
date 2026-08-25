-- leaflet_basic_parser_runs is internal processor telemetry.
-- Service-role Edge Functions bypass RLS and do not need client grants.
-- Remove historical anon/authenticated DML grants so a future RLS policy change
-- cannot accidentally turn this internal table into a client-facing surface.

revoke all privileges on table public.leaflet_basic_parser_runs from anon;
revoke all privileges on table public.leaflet_basic_parser_runs from authenticated;
