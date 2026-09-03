-- Reconstructed migration-history marker.
-- The optimized token-join implementation from production migration
-- 20260903081330 is already folded into
-- 20260903081029_catalog_quantity_semantic_consensus_v99.sql so a fresh deploy
-- never executes the known timeout-prone intermediate implementation.
select 1;