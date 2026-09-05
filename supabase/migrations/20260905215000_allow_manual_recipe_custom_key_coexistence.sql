-- Manual and recipe custom shopping rows may legitimately share the same
-- display/canonical name. Keep them separate by provenance instead of forcing
-- one row to overwrite the other.

DO $migration$
DECLARE
  v_indexdef text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.shopping_list_items'::regclass
      AND attname = 'is_recipe'
      AND NOT attisdropped
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'shopping_list_items.is_recipe NOT NULL is required before provenance-aware uniqueness';
  END IF;

  SELECT pg_get_indexdef(c.oid)
    INTO v_indexdef
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'shopping_list_items_one_custom_key_kind_per_list_uidx'
     AND c.relkind = 'i';

  IF v_indexdef IS NOT NULL AND (
    position('(shopping_list_id, custom_key, is_recipe)' in v_indexdef) = 0
    OR position('product_id IS NULL' in v_indexdef) = 0
    OR position('custom_key IS NOT NULL' in v_indexdef) = 0
  ) THEN
    RAISE EXCEPTION 'Existing provenance-aware shopping custom-key index has unexpected definition: %', v_indexdef;
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS shopping_list_items_one_custom_key_kind_per_list_uidx
  ON public.shopping_list_items (shopping_list_id, custom_key, is_recipe)
  WHERE product_id IS NULL AND custom_key IS NOT NULL;

DROP INDEX IF EXISTS public.shopping_list_items_one_custom_key_per_list_uidx;

DO $migration$
DECLARE
  v_definition text;
  v_original text;
  v_needle text;
  v_guarded text;
  v_count integer;
BEGIN
  -- Owner manual custom-add must never absorb a recipe row with the same name.
  v_definition := pg_get_functiondef(
    'public.add_own_shopping_list_custom_item(text,numeric,text,uuid)'::regprocedure
  );
  v_guarded := 'and i.custom_key = v_key' || E'\n    and not i.is_recipe';
  IF position(v_guarded in v_definition) = 0 THEN
    v_needle := 'and i.custom_key = v_key';
    v_count := (length(v_definition) - length(replace(v_definition, v_needle, ''))) / length(v_needle);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected add_own_shopping_list_custom_item custom-key target count: %', v_count;
    END IF;
    v_original := v_definition;
    v_definition := replace(v_definition, v_needle, v_guarded);
    IF v_definition = v_original THEN
      RAISE EXCEPTION 'Failed to isolate manual owner custom-add from recipe rows';
    END IF;
    EXECUTE v_definition;
  END IF;

  -- Offer fallback without product_id is still a manual shopping-list action.
  v_definition := pg_get_functiondef(
    'public.increment_own_shopping_list_offer(uuid)'::regprocedure
  );
  v_guarded := 'and i.custom_key = v_custom_key' || E'\n      and not i.is_recipe';
  IF position(v_guarded in v_definition) = 0 THEN
    v_needle := 'and i.custom_key = v_custom_key';
    v_count := (length(v_definition) - length(replace(v_definition, v_needle, ''))) / length(v_needle);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected increment_own_shopping_list_offer custom-key target count: %', v_count;
    END IF;
    v_original := v_definition;
    v_definition := replace(v_definition, v_needle, v_guarded);
    IF v_definition = v_original THEN
      RAISE EXCEPTION 'Failed to isolate manual offer fallback from recipe rows';
    END IF;
    EXECUTE v_definition;
  END IF;

  -- Shared-list custom add is also explicitly manual; do not reuse recipe rows.
  v_definition := pg_get_functiondef(
    'public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean)'::regprocedure
  );
  v_guarded := 'and i.custom_key = v_key' || E'\n        and not i.is_recipe';
  IF position(v_guarded in v_definition) = 0 THEN
    v_needle := 'and i.custom_key = v_key';
    v_count := (length(v_definition) - length(replace(v_definition, v_needle, ''))) / length(v_needle);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected mutate_shared_shopping_list custom-key target count: %', v_count;
    END IF;
    v_original := v_definition;
    v_definition := replace(v_definition, v_needle, v_guarded);
    IF v_definition = v_original THEN
      RAISE EXCEPTION 'Failed to isolate shared manual custom-add from recipe rows';
    END IF;
    EXECUTE v_definition;
  END IF;

  -- Repeating a purchase restores manual history rows. Both normal and
  -- unique-violation retry branches must exclude recipe rows.
  v_definition := pg_get_functiondef(
    'public.repeat_shopping_purchase(uuid)'::regprocedure
  );
  v_needle := 'and custom_key = v_custom_key;';
  v_count := (length(v_definition) - length(replace(v_definition, v_needle, ''))) / length(v_needle);
  IF v_count > 0 THEN
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'Unexpected repeat_shopping_purchase custom-key update count: %', v_count;
    END IF;
    v_original := v_definition;
    v_definition := replace(
      v_definition,
      v_needle,
      'and custom_key = v_custom_key' || E'\n          and not is_recipe;'
    );
    IF v_definition = v_original THEN
      RAISE EXCEPTION 'Failed to isolate repeat purchase manual rows from recipe rows';
    END IF;
    EXECUTE v_definition;
  ELSIF (
    (length(v_definition) - length(replace(v_definition, 'and not is_recipe;', '')))
      / length('and not is_recipe;')
  ) < 2 THEN
    RAISE EXCEPTION 'repeat_shopping_purchase is in an unexpected partial provenance state';
  END IF;

  -- Recipe sync must only discover/dedupe against another recipe row. A manual
  -- same-name row is allowed to coexist and must not be returned as a target.
  v_definition := pg_get_functiondef(
    'public.sync_own_shopping_list_recipe_item(uuid,text,text[])'::regprocedure
  );
  IF position('source_not_recipe_safe' in v_definition) = 0 THEN
    RAISE EXCEPTION 'Recipe sync source provenance guard is missing';
  END IF;
  v_guarded := 'and i.custom_key = v_key' || E'\n     and i.is_recipe';
  IF position(v_guarded in v_definition) = 0 THEN
    v_needle := 'and i.custom_key = v_key';
    v_count := (length(v_definition) - length(replace(v_definition, v_needle, ''))) / length(v_needle);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected recipe sync custom-key target count: %', v_count;
    END IF;
    v_original := v_definition;
    v_definition := replace(v_definition, v_needle, v_guarded);
    IF v_definition = v_original THEN
      RAISE EXCEPTION 'Failed to restrict recipe sync target to recipe rows';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$migration$;

-- Final fail-closed verification: old uniqueness must be gone and the new
-- provenance-aware uniqueness must exist after every successful replay.
DO $migration$
BEGIN
  IF to_regclass('public.shopping_list_items_one_custom_key_per_list_uidx') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy two-column shopping custom-key unique index still exists';
  END IF;
  IF to_regclass('public.shopping_list_items_one_custom_key_kind_per_list_uidx') IS NULL THEN
    RAISE EXCEPTION 'Provenance-aware shopping custom-key unique index is missing';
  END IF;
END
$migration$;
