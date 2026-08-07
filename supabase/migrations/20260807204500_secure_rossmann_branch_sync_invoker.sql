-- Rossmann byl přesunut na databázový pg_net synchronizační tok,
-- protože projekt dosáhl limitu počtu Supabase Edge Functions.
drop function if exists public.invoke_rossmann_branch_sync(boolean);
