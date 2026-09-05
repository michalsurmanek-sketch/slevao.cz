-- When manual and recipe custom rows share the same canonical name, recipe sync
-- must select the existing recipe row first. A manual row must not block safe
-- recipe deduplication merely because it is older.

DO $migration$
DECLARE
  definition text;
  original text;
  has_recipe_preference boolean;
BEGIN
  definition := pg_get_functiondef(
    'public.sync_own_shopping_list_recipe_item(uuid,text,text[])'::regprocedure
  );

  has_recipe_preference := position(
    $$order by i.is_recipe desc, i.is_completed asc, i.created_at asc, i.id$$ in definition
  ) > 0;

  IF has_recipe_preference THEN
    RAISE NOTICE 'Recipe target preference is already applied; skipping replay';
    RETURN;
  END IF;

  original := definition;
  definition := replace(
    definition,
    $$   order by i.is_completed asc, i.created_at asc, i.id$$,
    $$   order by i.is_recipe desc, i.is_completed asc, i.created_at asc, i.id$$
  );

  IF definition = original THEN
    RAISE EXCEPTION 'Expected recipe target ordering was not found';
  END IF;

  EXECUTE definition;
END
$migration$;
