-- Allow a narrowly-scoped recipe substitute for "Mleté hovězí maso":
-- catalogue offers named "Mleté maso mix" may be considered, while the existing
-- generic "Hovězí maso" guard must continue to reject minced/burger products.
--
-- This is intentionally a guarded patch of the current RPC definition. If the
-- expected production fragments drift, the migration fails instead of applying
-- a broad or partially-correct replacement.

DO $migration$
DECLARE
  definition text;
  original text;
BEGIN
  definition := pg_get_functiondef(
    'public.get_public_shopping_list_candidates(text[],integer)'::regprocedure
  );

  original := definition;
  definition := replace(
    definition,
    $$          when 'hovezi maso' then 'Hovězí zadní'
          when 'hladka mouka' then 'Pšeničná mouka'$$,
    $$          when 'hovezi maso' then 'Hovězí zadní'
          when 'mlete hovezi maso' then 'Mleté maso'
          when 'hladka mouka' then 'Pšeničná mouka'$$
  );

  IF definition = original THEN
    RAISE EXCEPTION 'Expected ground-beef recipe alias fragment was not found';
  END IF;

  original := definition;
  definition := replace(
    definition,
    $$        and (lower(public.unaccent(rec.ingredient_text)) <> 'hovezi maso' or s.candidate_text !~ '(mlet|meln|burger|tatarak)')
        and (lower(public.unaccent(rec.ingredient_text)) <> 'hladka mouka' or ($$,
    $$        and (lower(public.unaccent(rec.ingredient_text)) <> 'hovezi maso' or s.candidate_text !~ '(mlet|meln|burger|tatarak)')
        and (
          lower(public.unaccent(rec.ingredient_text)) <> 'mlete hovezi maso'
          or (
            s.candidate_text ~ '(^| )mlet[a-z]*( |$)'
            and s.candidate_text ~ '(^| )maso( |$)'
            and s.candidate_text !~ '(^| )(kurec|kruti|kachn|jehne|ryb)[a-z]*( |$)'
            and (
              s.candidate_text ~ '(^| )hovez[a-z]*( |$)'
              or s.candidate_text ~ '(^| )(mix|smes)[a-z]*( |$)'
            )
          )
        )
        and (lower(public.unaccent(rec.ingredient_text)) <> 'hladka mouka' or ($$
  );

  IF definition = original THEN
    RAISE EXCEPTION 'Expected ground-beef semantic guard fragment was not found';
  END IF;

  EXECUTE definition;
END
$migration$;
