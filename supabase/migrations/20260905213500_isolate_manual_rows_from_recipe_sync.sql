-- Recipe synchronization must never convert a manual custom row merely because
-- its display name looks like a recipe quantity label (for example "Vejce (3 ks)").
-- Existing recipe rows may still be merged/deduplicated by canonical custom key.
-- The patch is fail-closed and replay-safe against the current atomic RPC.

DO $migration$
DECLARE
  definition text;
  original text;
  has_source_guard boolean;
  has_strict_target_guard boolean;
BEGIN
  definition := pg_get_functiondef(
    'public.sync_own_shopping_list_recipe_item(uuid,text,text[])'::regprocedure
  );

  has_source_guard := position(
    $$'reason', 'source_not_recipe_safe'$$ in definition
  ) > 0;
  has_strict_target_guard := position(
    $$v_target_safe := v_target.is_recipe;$$ in definition
  ) > 0;

  IF has_source_guard OR has_strict_target_guard THEN
    IF has_source_guard AND has_strict_target_guard THEN
      RAISE NOTICE 'Manual/recipe isolation is already fully applied; skipping replay';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Manual/recipe isolation is only partially applied';
  END IF;

  original := definition;
  definition := replace(
    definition,
    $$  if v_source_found and v_source.custom_key = v_key then$$,
    $$  if v_source_found and not v_source.is_recipe then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'source_not_recipe_safe',
      'list_id', v_list_id,
      'item', to_jsonb(v_source)
    );
  end if;

  if v_source_found and v_source.custom_key = v_key then$$
  );

  IF definition = original THEN
    RAISE EXCEPTION 'Expected recipe source branch was not found';
  END IF;

  original := definition;
  definition := replace(
    definition,
    $$    v_target_safe := v_target.is_recipe
      or (
        v_target.quantity = 1
        and lower(coalesce(nullif(trim(v_target.unit), ''), 'ks')) = 'ks'
        and v_target.custom_name ~* '\([0-9]+([.,][0-9]+)?[[:space:]]+(kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků)\)[[:space:]]*$'
      );$$,
    $$    v_target_safe := v_target.is_recipe;$$
  );

  IF definition = original THEN
    RAISE EXCEPTION 'Expected permissive recipe target guard was not found';
  END IF;

  EXECUTE definition;
END
$migration$;
